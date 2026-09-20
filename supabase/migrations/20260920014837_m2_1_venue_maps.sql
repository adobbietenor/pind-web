-- Phase 2 M2.1 — the real venue map (decisions.md Part 5, "A real map, not a
-- schematic"). The picture is fetched once per venue from Mapbox, stored, and served
-- from our own origin; this migration is the bookkeeping that makes that safe.
--
-- Two things live here:
--   1. a key derived from the venue's coordinates, so the image's URL changes when the
--      coordinates do and an old image can never outlive a correction;
--   2. a record of every render attempt, so a venue whose image keeps failing is
--      findable in the admin instead of silently showing the fallback forever, and so
--      retries against a paid API are capped rather than looping.
--
-- No visibility change: a venue map shows a public building and its public spots,
-- never a person (H1), and the coordinates involved are the only ones this product
-- holds (H4).

-- ---------------------------------------------------------------------------
-- 1 · The key
--
-- md5 of the coordinates, shortened. It goes in the image's filename, so:
--   - the URL is content-addressed and can be cached for a year as immutable;
--   - correcting a venue's coordinates in the admin produces a NEW url, which nothing
--     has cached, and the old one is simply never requested again. There is no purge
--     to run and no window in which a stale image is served.
-- The Worker appends its own render version, so changing the zoom or the size also
-- changes the key without touching this function.
-- ---------------------------------------------------------------------------

create function public.venue_map_key(p_lat double precision, p_lng double precision)
returns text
language sql immutable set search_path = '' as $$
  select case
    when p_lat is null or p_lng is null then null
    else left(md5(round(p_lat::numeric, 6)::text || ',' || round(p_lng::numeric, 6)::text), 10)
  end;
$$;

revoke execute on function public.venue_map_key(double precision, double precision) from public;
grant execute on function public.venue_map_key(double precision, double precision) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · Render attempts — admin-only (V12)
--
-- One row per venue per key. `attempts` is what caps the retries: the Worker stops
-- asking Mapbox after a few failures, so a venue that can never render cannot quietly
-- run up a bill. `last_error` is what makes it findable.
-- ---------------------------------------------------------------------------

create table public.venue_map_renders (
  venue_id    uuid not null references public.venues (id) on delete cascade,
  map_key     text not null check (map_key ~ '^[a-z0-9-]{3,40}$'),
  status      text not null default 'pending' check (status in ('pending', 'ok', 'failed')),
  attempts    smallint not null default 0 check (attempts >= 0),
  last_error  text,
  bytes       integer,
  updated_at  timestamptz not null default now(),
  primary key (venue_id, map_key)
);

create index venue_map_renders_failed_idx on public.venue_map_renders (updated_at desc)
  where status <> 'ok';

alter table public.venue_map_renders enable row level security;

-- Supabase grants anon and authenticated everything on a new table. This one is the
-- service key's alone: it says which venue failed and why, which is operational
-- detail, not public fact.
revoke all on public.venue_map_renders from anon, authenticated;

-- Record the outcome of one attempt. Service key only, like every admin_* function.
create function public.admin_record_map_render(
  p_venue uuid, p_key text, p_ok boolean, p_error text default null, p_bytes integer default null
) returns smallint
language plpgsql set search_path = '' as $$
declare
  n smallint;
begin
  insert into public.venue_map_renders (venue_id, map_key, status, attempts, last_error, bytes, updated_at)
  values (p_venue, p_key, case when p_ok then 'ok' else 'failed' end, 1, left(p_error, 500), p_bytes, now())
  on conflict (venue_id, map_key) do update
    set status = case when p_ok then 'ok' else 'failed' end,
        attempts = public.venue_map_renders.attempts + 1,
        last_error = case when p_ok then null else left(p_error, 500) end,
        bytes = coalesce(p_bytes, public.venue_map_renders.bytes),
        updated_at = now()
  returning attempts into n;
  return n;
end;
$$;

revoke execute on function public.admin_record_map_render(uuid, text, boolean, text, integer)
  from public, anon, authenticated;
grant execute on function public.admin_record_map_render(uuid, text, boolean, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3 · The public door learns about the map
--
-- public_gathering already returns the venue; it now also returns the coordinate key
-- and the render keys that are ready, so W2 knows in the SAME round trip whether to
-- show the picture or the fallback. Nothing else about the render record is public:
-- the array carries keys, never a status, an error or an attempt count.
-- ---------------------------------------------------------------------------

create or replace function public.public_gathering(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g    public.gatherings;
  live text;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return jsonb_build_object('status', 'gone');
  end if;

  select * into g from public.gatherings x
  where x.slug = p_slug and x.published_at is not null and not x.is_seed;

  if not found then
    -- A slug this gathering used to have: point at the one it has now.
    select x.slug into live
    from public.gathering_slug_history h
    join public.gatherings x on x.id = h.gathering_id
    where h.slug = p_slug and x.published_at is not null and not x.is_seed and x.slug is not null;

    if live is null then return jsonb_build_object('status', 'gone'); end if;
    return jsonb_build_object('status', 'redirect', 'slug', live);
  end if;

  if g.withdrawn_at is not null then
    return jsonb_build_object('status', 'withdrawn');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'gathering', jsonb_build_object(
      'id', g.id,
      'slug', g.slug,
      'name', g.name,
      'starts_at', g.starts_at,
      'ends_at', g.ends_at,
      'effective_end', public.effective_end(g),
      'is_free', g.is_free,
      'source', g.source,
      'event_url', g.event_url
    ),
    'venue', (
      select jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'address', v.address,
        'latitude', v.latitude,
        'longitude', v.longitude,
        'map_image_path', v.map_image_path,
        'map_key', public.venue_map_key(v.latitude, v.longitude),
        'map_ready', coalesce((
          select jsonb_agg(r.map_key)
          from public.venue_map_renders r
          where r.venue_id = v.id and r.status = 'ok'
        ), '[]'::jsonb),
        'city_name', c.name,
        'timezone', c.timezone
      )
      from public.venues v
      join public.cities c on c.slug = v.city
      where v.id = g.venue_id
    ),
    'spots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', s.name,
               'description', s.description,
               'latitude', s.latitude,
               'longitude', s.longitude,
               'walk_minutes', s.walk_minutes,
               'meet_at', gs.meet_at
             ) order by s.sort_order, s.created_at)
      from public.gathering_spots gs
      join public.meeting_spots s on s.id = gs.spot_id
      where gs.gathering_id = g.id and s.active
    ), '[]'::jsonb),
    'counts', (
      select to_jsonb(co) - 'gathering_id'
      from public.gathering_counts(array[g.id]) co
    )
  );
end;
$$;
