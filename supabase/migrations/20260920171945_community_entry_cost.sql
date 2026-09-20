-- What it costs to walk in (Alex, after M2.2) — a third state between free and
-- ticketed.
--
-- `is_free` had two values and the world has three. Pub Chess is $10 cash at the
-- door; Snakes & Lattes Game Night is $20 admission. Neither is free and neither is
-- ticketed, so both buttons were wrong: "I've got a ticket" describes something that
-- does not exist, and "I'm going" hides a cost. The second is the worse failure — it
-- sends somebody to a door with no cash, which is the honest-numbers rule (H6) in a
-- different coat.
--
-- Most community gatherings are drop-in with a small cost, so this is the common case
-- from M4.4 onwards rather than an edge.
--
-- Three columns, and `is_free` goes. Keeping it as a derived column would leave two
-- sources of truth for one fact, which is exactly what the stale FOLD_THRESHOLD was:
-- a number nothing used any more, still deciding what Alex saw.

create type public.entry_kind as enum ('free', 'door', 'ticketed');

alter table public.gatherings
  add column entry public.entry_kind not null default 'ticketed',
  -- Null means the price is not known, which is a different state from no cost: the
  -- page then says "pay at the door" rather than a number, and never "free".
  add column door_price_cents integer check (door_price_cents between 0 and 100000),
  -- "cash only", "$15 for students". "$10 at the door" and "$10 cash at the door" are
  -- different promises, and turning up with only a card is the failure that matters.
  add column entry_note text check (char_length(entry_note) <= 60),
  -- A price on a free or ticketed gathering is meaningless: the door is the only
  -- thing this product knows the price of.
  add constraint gatherings_door_price_needs_a_door
    check (entry = 'door' or (door_price_cents is null and entry_note is null));

comment on column public.gatherings.entry is
  'What it costs to walk in: free, pay at the door, or ticketed. Replaces is_free, which had two values for a world with three.';
comment on column public.gatherings.door_price_cents is
  'Null means unknown, never free. The page says "pay at the door" rather than inventing a number.';

update public.gatherings
set entry = (case when is_free then 'free' else 'ticketed' end)::public.entry_kind;

-- ---------------------------------------------------------------------------
-- The public read paths move over in the same migration, so there is never a moment
-- when one of them is reading a column that has gone.
-- ---------------------------------------------------------------------------

drop function public.public_gatherings(timestamptz, timestamptz);

create function public.public_gatherings(p_from timestamptz, p_to timestamptz)
returns table (
  slug             text,
  name             text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  entry            public.entry_kind,
  door_price_cents integer,
  entry_note       text,
  source           public.gathering_source,
  venue_name       text,
  city_name        text,
  city_timezone    text,
  pinned           integer,
  open_to_meeting  integer,
  crews_open       boolean
)
language sql stable set search_path = '' as $$
  select
    g.slug, g.name, g.starts_at, g.ends_at, g.entry, g.door_price_cents, g.entry_note, g.source,
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

-- public_gathering keeps its whole body; only the gathering object changes.
create or replace function public.public_gathering(p_slug text) returns jsonb
language plpgsql security definer stable set search_path = '' as $$
declare
  g    public.gatherings;
  live text;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return jsonb_build_object('status', 'gone');
  end if;

  select x.* into g from public.gatherings x
  where x.slug = p_slug and x.published_at is not null and not x.is_seed;

  if not found then
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
      'entry', g.entry,
      'door_price_cents', g.door_price_cents,
      'entry_note', g.entry_note,
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
        'city_name', c.name,
        'city_timezone', c.timezone
      )
      from public.venues v join public.cities c on c.slug = v.city where v.id = g.venue_id
    ),
    'spots', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', ms.name, 'description', ms.description, 'meet_at', gs.meet_at,
        'latitude', ms.latitude, 'longitude', ms.longitude, 'walk_minutes', ms.walk_minutes
      ) order by gs.meet_at, ms.name), '[]'::jsonb)
      from public.gathering_spots gs join public.meeting_spots ms on ms.id = gs.spot_id
      where gs.gathering_id = g.id
    ),
    'counts', (
      select jsonb_build_object('pinned', co.pinned, 'open_to_meeting', co.open_to_meeting, 'crews_open', co.crews_open)
      from public.gathering_counts(array[g.id]) co
    )
  );
end;
$$;

alter table public.gatherings drop column is_free;
