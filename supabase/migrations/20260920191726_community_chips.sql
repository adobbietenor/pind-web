-- `taking_part` splits into four (Alex, after the wider community pass), so the
-- Community tab has chips that do something instead of one chip holding everything.
--
-- Measured against the real 31 before choosing, and the counts decided the shape:
--
--   bucket              gatherings  rows  venues
--   games                        9    71       4
--   cycling                      8    13       8
--   running                      4    59       2
--   outdoors                     3     3       3
--   markets & street             3    11       3
--   making                       2    27       2
--   reading & talking            2     4       1
--
-- **Running and cycling stay apart** although they look alike, because they behave
-- oppositely: running is four clubs meeting constantly at two venues, cycling is
-- eight gatherings at eight venues, a different place every time. One chip would hide
-- both facts — a reader filtering "running" wants a fixture near them, one filtering
-- "cycling" is choosing a Saturday out.
--
-- **Making and reading get no chip yet**, and the measure is venues, not count:
-- "reading & talking" is four rows at *one* library, so filtering to it shows east
-- Scarborough or nothing. A chip earns its place at three distinct venues. Below
-- that its gatherings still appear — unfiltered is the default, so only a chip can
-- hide a row — they simply have no chip of their own. Both are library programmes,
-- and the libraries are exactly where M4.4 should start, so both may earn one soon.
--
-- Nothing in the Events tab changes.

drop function public.public_gatherings(timestamptz, timestamptz);

alter table public.gatherings drop column category;
drop type public.gathering_category;

create type public.gathering_category as enum (
  -- Events
  'live_music', 'sport', 'comedy',
  -- Community
  'games', 'cycling', 'running', 'outdoors', 'markets'
);

alter table public.gatherings add column category public.gathering_category;

comment on column public.gatherings.category is
  'The chip a reader filters by, within a tab. Null means nobody has said — unclassified and still visible, because unfiltered is the default. Separate from the coarse bucket the publisher caps on.';

create index gatherings_category_idx on public.gatherings (category) where category is not null;

-- Re-tagging the hand-entered list. Deliberately explicit rather than clever: a rule
-- nobody can read is not a category anybody can trust.
update public.gatherings set category = 'running'
where source = 'manual' and (name ilike '%run club%' or name ilike '%frontrunners%' or name ilike '%running rats%');

update public.gatherings set category = 'cycling'
where source = 'manual' and (name ilike 'TBN %' or name ilike '%ride%' or name ilike '%wheeler%' or name ilike '%roller%');

update public.gatherings set category = 'games'
where source = 'manual' and (name ilike '%chess%' or name ilike '%game night%' or name ilike '%clocktower%'
  or name ilike '%trivia%' or name ilike '%designer night%');

update public.gatherings set category = 'outdoors'
where source = 'manual' and (name ilike '%birding%' or name ilike '%ornithological%');

update public.gatherings set category = 'markets'
where source = 'manual' and (name ilike '%market%' or name ilike '%pedestrian sundays%');

-- Knitting circles and book clubs keep no chip until three venues carry them; they
-- stay on every unfiltered list either way.

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
