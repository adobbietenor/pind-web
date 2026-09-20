-- Phase 2 M2.1 — the seed rule (V18) and the public web's read surface
-- (docs/visibility.md V18; decisions.md Part 5, "pind.social before production",
-- H6, H11; spec.md §2).
--
-- THE RULE, in one line: a seed row is invisible to every visitor — signed out and
-- signed in alike. Only the service key sees it.
--
-- Nobody but the admin can see a seed gathering on the week's list or open its crowd
-- page, get its counts, its OG image, its share card or its .ics; see a seed venue or
-- its meeting spots; see a seed person anywhere a person appears; or have a seed
-- person's pin move any public number (H6 — a fabricated pin never moves a count).
-- A seed person, for their part, sees nobody: the flag cuts both ways, exactly like
-- hidden_at.
--
-- How, the same way "withdrawn" was done in M1.3: private.is_published and
-- private.list_open gain the condition, and every M1.1 rule already runs through one
-- of those two, so pins, votes, surveys, photos, +1s, reports, group links and the
-- women-only offer follow without their own policies changing. private.is_open_at
-- carries the person half. The gathering row, the venue, the spots and the counts get
-- their own conditions below.
--
-- This is permanent, not an M2.1 workaround. When pind-prod exists (M4.3) the rule
-- stays; the only non-real rows ever allowed on production are the review-only ones
-- for App Review, which get their own rule (V15) in M5.1.

-- ---------------------------------------------------------------------------
-- 1 · The seed rule
-- ---------------------------------------------------------------------------

-- Used only by the meeting_spots policy, which has no is_seed column of its own.
-- Security definer so the lookup is not itself filtered by the venue policy that is
-- hiding the very row it has to check.
create function private.is_seed_venue(p_venue uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.venues v where v.id = p_venue and v.is_seed);
$$;

revoke execute on function private.is_seed_venue(uuid) from public;
grant execute on function private.is_seed_venue(uuid) to anon, authenticated;

-- V11 + withdrawn + V18. Pin and survey inserts, spot votes, the spot poll, the group
-- links and the women-only offer all reach this.
create or replace function private.is_published(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    where g.id = p_gathering
      and g.published_at is not null
      and g.withdrawn_at is null
      and not g.is_seed
  );
$$;

-- V1: the people list is open — published, not withdrawn, not seeded, and until 24h
-- after the effective end.
create or replace function private.list_open(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    where g.id = p_gathering
      and g.published_at is not null
      and g.withdrawn_at is null
      and not g.is_seed
      and now() < public.effective_end(g) + interval '24 hours'
  );
$$;

-- V1 + V18: a seed person is not "open" at any gathering, which makes them invisible
-- to everyone and leaves them able to see nobody — the same shape as hidden_at, one
-- line above it. Every people, pin, photo, +1 and report rule runs through here.
create or replace function private.is_open_at(p_person uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.pins pi
    join public.people pe on pe.id = pi.person_id
    where pi.person_id = p_person
      and pi.gathering_id = p_gathering
      and pi.open_to_meeting
      and pe.hidden_at is null
      and not pe.is_seed
  );
$$;

-- The gathering row: published and live for everyone, withdrawn only for the people
-- pinned to it — and never if it is seeded.
drop policy gatherings_read_published on public.gatherings;
create policy gatherings_read_published on public.gatherings
  for select to anon, authenticated
  using (
    published_at is not null
    and not is_seed
    and (withdrawn_at is null or private.i_am_pinned_at(id))
  );

-- Spot options: published, not withdrawn, not seeded.
drop policy gathering_spots_read_published on public.gathering_spots;
create policy gathering_spots_read_published on public.gathering_spots
  for select to anon, authenticated
  using (exists (
    select 1 from public.gatherings g
    where g.id = gathering_id
      and g.published_at is not null
      and g.withdrawn_at is null
      and not g.is_seed
  ));

-- Venues and their meeting spots are public places, still readable regardless of any
-- gathering — unless they are seeded.
drop policy venues_read on public.venues;
create policy venues_read on public.venues
  for select to anon, authenticated using (not is_seed);

drop policy meeting_spots_read on public.meeting_spots;
create policy meeting_spots_read on public.meeting_spots
  for select to anon, authenticated using (not private.is_seed_venue(venue_id));

-- Retired slugs: readable for the gatherings whose rows are readable, so /g/<old>
-- can answer 301. Nothing else about them is public, and nobody but the service key
-- writes them.
create policy gathering_slug_history_read on public.gathering_slug_history
  for select to anon, authenticated
  using (exists (
    select 1 from public.gatherings g
    where g.id = gathering_id and g.published_at is not null and not g.is_seed
  ));

-- V2 + V3 + V18 counts. A seed gathering has no counts at all; a seed person moves no
-- count anywhere, including "pinned", which otherwise counts people who are hidden
-- because they are still going (H6). A seeded pin is not someone going — it is not
-- real, so it is not a number.
create or replace function public.gathering_counts(gathering_ids uuid[])
returns table (
  gathering_id     uuid,
  pinned           integer,
  open_to_meeting  integer,
  women            integer,
  men              integer,
  other            integer,
  crews_open       boolean
)
language sql stable security definer set search_path = '' as $$
  with per_gathering as (
    select
      g.id as gid,
      coalesce(sum(pi.party_total) filter (where not pe.is_seed), 0)::integer as n_pinned,
      (count(pi.id) filter (where pi.open_to_meeting and pe.hidden_at is null and not pe.is_seed))::integer as n_open,
      (count(pi.id) filter (where pi.open_to_meeting and pe.hidden_at is null and not pe.is_seed and pp.gender = 'woman'))::integer as n_women,
      (count(pi.id) filter (where pi.open_to_meeting and pe.hidden_at is null and not pe.is_seed and pp.gender = 'man'))::integer as n_men
    from public.gatherings g
    left join public.pins pi on pi.gathering_id = g.id
    left join public.people pe on pe.id = pi.person_id
    left join public.people_private pp on pp.person_id = pi.person_id
    where g.id = any (gathering_ids)
      and g.published_at is not null
      and not g.is_seed
      and (g.withdrawn_at is null or private.i_am_pinned_at(g.id))
    group by g.id
  )
  select
    gid,
    n_pinned,
    n_open,
    case when n_open >= 5 then n_women end,
    case when n_open >= 5 then n_men end,
    case when n_open >= 5 and n_open - n_women - n_men > 0 then n_open - n_women - n_men end,
    n_open >= 5
  from per_gathering;
$$;

-- ---------------------------------------------------------------------------
-- 2 · Minting slugs
--
-- Public URLs are minted by the publish action and by nothing else, which is what
-- keeps the policy harness off the public web: the harness inserts its gatherings
-- straight through the service key, so its rows never get a slug, and a row without
-- a slug appears on no public list and has no public URL. See docs/visibility.md
-- §12f for why that exception is deliberate.
-- ---------------------------------------------------------------------------

-- "Leafs vs Bruins" starting 14 October in Toronto -> leafs-vs-bruins-oct-14.
-- Service key only, like every other admin_* function.
create function public.admin_mint_slug(p_gathering uuid) returns text
language plpgsql set search_path = '' as $$
declare
  g         public.gatherings;
  tz        text;
  base      text;
  stem      text;
  candidate text;
  n         integer := 1;
begin
  select * into g from public.gatherings where id = p_gathering;
  if not found then raise exception 'Gathering not found'; end if;
  if g.slug is not null then return g.slug; end if;

  select c.timezone into tz
  from public.venues v
  join public.cities c on c.slug = v.city
  where v.id = g.venue_id;
  tz := coalesce(tz, 'America/Toronto');

  base := btrim(regexp_replace(lower(g.name), '[^a-z0-9]+', '-', 'g'), '-');
  if char_length(base) > 48 then
    -- Cut back to a whole word, so a slug never ends mid-name.
    base := btrim(regexp_replace(btrim(left(base, 48), '-'), '-[^-]*$', ''), '-');
  end if;
  if char_length(base) < 1 then base := 'gathering'; end if;

  stem := base || '-' || to_char(g.starts_at at time zone tz, 'mon-dd');

  candidate := stem;
  while exists (select 1 from public.gatherings x where x.slug = candidate)
     or exists (select 1 from public.gathering_slug_history h where h.slug = candidate) loop
    n := n + 1;
    if n > 50 then raise exception 'Could not mint a slug for %', g.name; end if;
    candidate := stem || '-' || n::text;
  end loop;

  update public.gatherings set slug = candidate where id = p_gathering;
  return candidate;
end;
$$;

-- Alex renaming a URL by hand. The old slug is retired by the trigger and keeps
-- answering 301 forever.
create function public.admin_set_slug(p_gathering uuid, p_slug text, p_actor text) returns text
language plpgsql set search_path = '' as $$
declare
  cleaned text;
  was     text;
begin
  cleaned := btrim(regexp_replace(lower(coalesce(p_slug, '')), '[^a-z0-9]+', '-', 'g'), '-');
  if char_length(cleaned) < 3 or char_length(cleaned) > 80 then
    raise exception 'A slug is 3 to 80 characters of letters, numbers and hyphens';
  end if;

  select slug into was from public.gatherings where id = p_gathering for update;
  if not found then raise exception 'Gathering not found'; end if;
  if was is not distinct from cleaned then return cleaned; end if;

  update public.gatherings set slug = cleaned where id = p_gathering;
  insert into public.moderation_log (actor, action, gathering_id, note)
  values (p_actor, 'slug_change', p_gathering, coalesce(was, '(none)') || ' -> ' || cleaned);
  return cleaned;
end;
$$;

-- Publishing now also mints the public URL. Everything else is unchanged.
create or replace function public.admin_publish_gathering(p_gathering uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
declare
  g public.gatherings;
begin
  select * into g from public.gatherings where id = p_gathering for update;
  if not found then raise exception 'Gathering not found'; end if;
  if g.published_at is not null then raise exception 'Already published'; end if;
  if g.dismissed_at is not null then raise exception 'Dismissed: restore it first'; end if;
  if g.starts_at <= now() then raise exception 'Cannot publish: it has already started'; end if;
  if g.venue_id is null then raise exception 'Cannot publish: the gathering has no venue'; end if;

  delete from public.gathering_spots gs
  using public.meeting_spots s
  where gs.gathering_id = p_gathering
    and s.id = gs.spot_id
    and (s.venue_id <> g.venue_id or not s.active);

  perform public.admin_top_up_spot_poll(p_gathering);

  update public.gatherings set published_at = now() where id = p_gathering;
  perform public.admin_mint_slug(p_gathering);
  insert into public.moderation_log (actor, action, gathering_id) values (p_actor, 'publish', p_gathering);
end;
$$;

revoke execute on function
  public.admin_mint_slug(uuid),
  public.admin_set_slug(uuid, text, text)
  from public, anon, authenticated;
grant execute on function
  public.admin_mint_slug(uuid),
  public.admin_set_slug(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3 · What the public web may read
--
-- W1, W2, W3, the OG image and the .ics all read through these two functions and
-- nothing else, so "what is on the public web" is one definition in one place
-- rather than a filter repeated in Worker code (H11).
--
-- On the public web = published, not withdrawn, not seeded, and carrying a slug.
--
-- Neither function returns anything about a person. Counts are aggregates from
-- gathering_counts (V2); names, photos and handles are not in reach of either
-- (H1, H3).
-- ---------------------------------------------------------------------------

-- W1, this week's crowds. Security invoker: the gatherings policy above already says
-- what a visitor may see, and this adds only the slug condition and the window.
-- Ordered by date, never by size (Q10).
create function public.public_gatherings(p_from timestamptz, p_to timestamptz)
returns table (
  slug            text,
  name            text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  is_free         boolean,
  source          public.gathering_source,
  venue_name      text,
  city_name       text,
  city_timezone   text,
  pinned          integer,
  open_to_meeting integer,
  crews_open      boolean
)
language sql stable set search_path = '' as $$
  select
    g.slug, g.name, g.starts_at, g.ends_at, g.is_free, g.source,
    v.name, c.name, c.timezone,
    coalesce(co.pinned, 0), coalesce(co.open_to_meeting, 0), coalesce(co.crews_open, false)
  from public.gatherings g
  join public.venues v on v.id = g.venue_id
  join public.cities c on c.slug = v.city
  left join lateral public.gathering_counts(array[g.id]) co on true
  where g.slug is not null
    and g.withdrawn_at is null
    and g.starts_at >= p_from
    and g.starts_at < p_to
  order by g.starts_at, g.name;
$$;

-- W2, W3, W4 and the .ics: one gathering by slug, in one round trip, with its venue,
-- its meeting spots and its counts.
--
-- Security definer, for one reason: a withdrawn gathering's row is hidden from
-- everyone but the people pinned to it (V13), yet /g/<slug> still has to answer the
-- short neutral "no longer on Pin'd" rather than a 404 (spec §2 W2). So this function
-- can see a withdrawn row — and for one it returns the word "withdrawn" and nothing
-- else at all: no name, no venue, no date, no counts. A visitor learns only that this
-- URL is no longer on Pin'd, which is strictly less than the page told them yesterday.
--
-- Because it is definer, every condition the policies would have applied is written
-- out here instead. status is one of: 'ok', 'redirect', 'withdrawn', 'gone'.
create function public.public_gathering(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g       public.gatherings;
  live    text;
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
        'name', v.name,
        'address', v.address,
        'latitude', v.latitude,
        'longitude', v.longitude,
        'map_image_path', v.map_image_path,
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

revoke execute on function
  public.public_gatherings(timestamptz, timestamptz),
  public.public_gathering(text)
  from public;
grant execute on function
  public.public_gatherings(timestamptz, timestamptz),
  public.public_gathering(text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Slugs for what is already published
--
-- Staging has published gatherings from M1.2 and M1.3 that pre-date slugs. Mint one
-- for each so they have a public URL; seeded rows get one too (harmless — they are
-- invisible either way, and it keeps "published implies a slug" true).
-- ---------------------------------------------------------------------------

do $$
declare gid uuid;
begin
  for gid in select id from public.gatherings where published_at is not null and slug is null loop
    perform public.admin_mint_slug(gid);
  end loop;
end;
$$;
