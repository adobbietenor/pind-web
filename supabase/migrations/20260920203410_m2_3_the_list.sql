-- Phase 2 M2.3 — the list at fifty a week (W1).
--
-- Three things, none of them a visibility change. No policy is added, altered or
-- dropped here; nothing about who sees whom moves (H11); no row becomes readable
-- that was not readable before. What changes is that the list can be *browsed*.
--
--   1. Every Ticketmaster gathering gets the chip a reader filters by. It had none:
--      all 49 published Events rows carried `category = null`, so the Events tab
--      would have shown a chip row with nothing in it.
--   2. public_gatherings returns `venue_id`, so a chip can be tested against the
--      number of distinct venues behind it rather than against distinct venue names.
--   3. public_gathering returns the venue's active spot coordinates, so W2 can pick
--      the map's zoom from the venue's whole spot set in the same round trip.
--
-- ---------------------------------------------------------------------------
-- 1 · The chip a Ticketmaster row wears
--
-- Ticketmaster classifies every listing as "Segment / Genre" and stores it in
-- gathering_sources.snapshot: Music / Rock, Sports / Hockey, Arts & Theatre /
-- Comedy. Measured over every snapshot we hold (drafts included), the feed is:
--
--   Music / *              523      →  live_music   (label: "Music")
--   Sports / *              83      →  sport
--   Arts & Theatre / Comedy 51      →  comedy
--   Arts & Theatre / other  59      →  null
--   Miscellaneous, Film, null 41    →  null
--
-- **Music / Dance-Electronic is 94 of the 523 and still goes to live_music**, because
-- the feed cannot tell a DJ night from a gig — the same rooms host both, measured
-- (decisions.md, "No 'going out' chip"). The chip is labelled "Music" rather than
-- "Live music" for exactly that reason: 15 of the 39 published are club nights, and
-- a DJ set is not live music.
--
-- **Theatre, classical and opera get no chip and are still on every unfiltered
-- list.** Null is a real answer, not a gap: unfiltered is the default, so only a chip
-- can hide a row.
--
-- **The lifecycle, decided by Alex (M2.3):** a category is set ONCE, when the draft
-- is created, from that listing's own classification. The importer never overwrites
-- it afterwards, so an edit in the admin is final and a genre Ticketmaster changes
-- later never silently re-tags a published gathering. That is why the function below
-- only ever writes where the column is null.
--
-- One rule in one place: this function is what the nightly import calls and what the
-- backfill at the bottom of this migration calls. There is no second copy of the
-- mapping in the Worker to drift away from it.
-- ---------------------------------------------------------------------------

create function public.chip_category(p_classification text)
returns public.gathering_category
language sql immutable set search_path = '' as $$
  select case
    when p_classification is null then null
    when p_classification like 'Music%' then 'live_music'
    when p_classification like 'Sports%' then 'sport'
    when p_classification = 'Arts & Theatre / Comedy' then 'comedy'
  end::public.gathering_category;
$$;

comment on function public.chip_category(text) is
  'Ticketmaster''s "Segment / Genre" to the chip a reader filters by. Null is a real answer: unclassified rows stay on every unfiltered list. Never guesses a club night apart from a gig — the feed cannot.';

revoke execute on function public.chip_category(text) from public, anon, authenticated;
grant execute on function public.chip_category(text) to service_role;

-- Fill in every draft or published gathering that still has no category, from the
-- classification its own source snapshot carries. Called by the nightly import after
-- it applies its plan, so a category is set in the same run the draft is created in,
-- and by the backfill below for everything already here.
--
-- `min(...)` picks one classification where a gathering carries several Ticketmaster
-- ids: duplicates are folded into one draft (M1.3) and they share a classification,
-- so the choice is deterministic rather than arbitrary.
create function public.admin_categorise_gatherings() returns integer
language plpgsql set search_path = '' as $$
declare
  n integer;
begin
  update public.gatherings g
  set category = public.chip_category(x.classification)
  from (
    select gs.gathering_id, min(gs.snapshot ->> 'category') as classification
    from public.gathering_sources gs
    where gs.source = 'ticketmaster'
    group by gs.gathering_id
  ) x
  where x.gathering_id = g.id
    -- Only where nobody has said. This is the whole of the "set once, never
    -- overwritten" rule, in one line.
    and g.category is null
    and public.chip_category(x.classification) is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.admin_categorise_gatherings() is
  'Gives every uncategorised Ticketmaster gathering the chip its own listing implies. Writes only where category is null, so an admin edit is final and a changed genre never re-tags anything.';

revoke execute on function public.admin_categorise_gatherings() from public, anon, authenticated;
grant execute on function public.admin_categorise_gatherings() to service_role;

-- ---------------------------------------------------------------------------
-- 2 · The public door returns the venue's id
--
-- A chip earns its place at three distinct gatherings in at least two distinct
-- places (CHIP_MIN_GATHERINGS, CHIP_MIN_VENUES in packages/shared). Counting those
-- places by venue *name* is the kind of nearly-right that bites later — two rooms
-- can share a name, and one venue can be renamed. So the door returns the id.
--
-- Nothing else about this function changes: same where-clause, same order, same
-- definition of "on the public web" — published, not withdrawn, not seeded, carrying
-- a slug (M2.1). Rebuilt from the live definition, which is the one
-- 20260920191726_community_chips left behind and which the database confirmed by
-- returning exactly its columns before this was written.
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
  category         public.gathering_category,
  signup_required  boolean,
  source           public.gathering_source,
  venue_id         uuid,
  venue_name       text,
  city_name        text,
  city_timezone    text,
  pinned           integer,
  open_to_meeting  integer,
  crews_open       boolean
)
language sql stable set search_path = '' as $$
  select
    g.slug, g.name, g.starts_at, g.ends_at, g.entry, g.door_price_cents, g.entry_note,
    g.category, g.signup_required, g.source,
    v.id, v.name, c.name, c.timezone,
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

-- ---------------------------------------------------------------------------
-- 3 · The crowd page learns the venue's whole spot set
--
-- Why: the map's zoom stops being a constant. Three spots a two-minute walk apart
-- land inside one label's width of each other at zoom 16 — measured on the real
-- venues, where three of the six with more than one spot overlap — and the cure is
-- to zoom the picture in until they separate, not to shuffle labels on top of a
-- picture that is too wide.
--
-- The zoom has to be a property of the VENUE, not of one gathering, or two gatherings
-- at the same venue with different spot polls would want two different pictures and
-- the "one Mapbox image per venue, ever" rule would quietly become one per gathering.
-- A gathering's poll shows up to 3 of the venue's spots; the zoom is chosen from all
-- of them. So the venue now carries the coordinates of its active spots, and the
-- Worker picks the zoom from those — the same input, and the same answer, on the
-- crowd page and in the job that renders the picture.
--
-- Nothing private is exposed. A meeting spot is a curated public place (H5) and its
-- coordinates are already on every crowd page at that venue; this adds no fact about
-- a person and no coordinate belonging to one (H1, H4). `spots` — the poll itself —
-- is unchanged.
--
-- Rebuilt from the live definition (20260920183930_signup_and_capacity), confirmed
-- against the database by reading back its keys first. That check exists because a
-- `create or replace` from a superseded definition is a silent revert, which is how
-- M2.1's real map briefly disappeared from every crowd page.
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
      'category', g.category,
      'signup_url', g.signup_url,
      'signup_required', g.signup_required,
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
        -- Every active spot this venue has, coordinates only, so the zoom is the
        -- venue's and not this gathering's. Not the poll: that is `spots` below.
        'map_spots', coalesce((
          select jsonb_agg(jsonb_build_object('latitude', s.latitude, 'longitude', s.longitude)
                           order by s.sort_order, s.created_at)
          from public.meeting_spots s
          where s.venue_id = v.id and s.active
            and s.latitude is not null and s.longitude is not null
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

-- ---------------------------------------------------------------------------
-- 4 · The backfill, through the same function the importer uses
-- ---------------------------------------------------------------------------

select public.admin_categorise_gatherings();
