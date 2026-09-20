-- The five categories a reader filters by (Alex, after the community pass), replacing
-- the first guess of sports / concerts / bars / clubs / community.
--
-- The distinction that matters to someone scanning is **what they would be doing**,
-- not what the subject is: a run club and a Leafs game are not both "sports", and Pub
-- Chess is in a brewery but nobody is going for the beer. Measured against the real
-- feed, though, the pure verb split does not survive contact:
--
--   Music 523 · Arts & Theatre 102 · Sports 83 · Miscellaneous 9 · hand entered 92
--
-- "Watching" would be 87% of the list, which filters nothing, so the watching kinds
-- stay separate — a reader who wants to watch still has to pick what. The verb idea
-- earns its place where it actually divides the list: taking part, and wandering.
--
--   live_music   Music / *                     523
--   sport        Sports / *                     83   spectator; a run club is not this
--   comedy       Arts & Theatre / Comedy        48   singular: theatre, classical and
--                                                    opera are capped at 35 by the AI
--                                                    rubric and never clear the floor
--   taking_part  hand entered, then M4.4        73   run clubs, chess, game nights
--   markets      hand entered, then M4.4         8   markets, street festivals
--
-- **Null stays a real answer**: unclassified, and still visible. Unfiltered is the
-- default, so only a chip can hide a row, and no row disappears for want of a label.
--
-- No "going out" chip. The feed cannot tell a DJ night from a gig — see decisions.md.

-- public_gatherings returns the type, so it goes first and comes back at the end.
drop function public.public_gatherings(timestamptz, timestamptz);

alter table public.gatherings drop column category;
drop type public.gathering_category;

create type public.gathering_category as enum ('live_music', 'sport', 'comedy', 'taking_part', 'markets');

alter table public.gatherings add column category public.gathering_category;

comment on column public.gatherings.category is
  'What a reader filters by. Null means nobody has said — unclassified and still visible, because unfiltered is the default. Separate from the coarse bucket the publisher caps on (src/publish/run.ts), which is a different job.';

create index gatherings_category_idx on public.gatherings (category) where category is not null;

-- The seven entered by hand on 20 September, by name: four things people take part in,
-- two they wander through.
update public.gatherings set category = 'taking_part'
where source = 'manual' and name in (
  'Pub Chess Liberty',
  'College Social Game Night',
  'Frontrunners Toronto — Saturday social run',
  'Frontrunners Toronto — Thursday run',
  'Hart House Chess Club'
);

update public.gatherings set category = 'markets'
where source = 'manual' and name in (
  'Trinity Bellwoods Farmers'' Market',
  'Pedestrian Sundays in Kensington Market'
);

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
    g.category, g.source,
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
