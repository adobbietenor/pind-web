-- M3.3c — the public list is asked for one city (Alex, 6 Oct 2026; the app's home, A5).
--
-- public_gatherings is the single definition of "on the public web" (M2.1, H11), and
-- the app's Toronto list now reads it too — the same query as W1, no copy. It was not
-- city-scoped: it returned every published, non-seed gathering in every city. With only
-- Toronto live that was invisible, but staging now holds a Vancouver city (the walk
-- gathering's time zone), and a picker that says "Toronto" must not be able to list
-- anything else. So the caller names the city — W1 and the app both pass the live city
-- from packages/shared/src/cities.ts — and a gathering appears only under the city its
-- venue is in. There is no default: a caller that forgets the city gets an error, not
-- every city. The seed rule is unchanged and separate: a seed row is never on this
-- list, for anyone, in any city (V18). Proved by P185.

-- Added alongside the two-argument version, which the deployed W1 still calls; that one
-- is dropped by the next migration, once the Worker that passes the city is live.

create function public.public_gatherings(p_from timestamptz, p_to timestamptz, p_city text)
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
  blurb            text,
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
    g.category, g.signup_required, g.blurb, g.source,
    v.id, v.name, c.name, c.timezone,
    coalesce(co.pinned, 0), coalesce(co.open_to_meeting, 0), coalesce(co.crews_open, false)
  from public.gatherings g
  join public.venues v on v.id = g.venue_id
  join public.cities c on c.slug = v.city
  left join lateral public.gathering_counts(array[g.id]) co on true
  where g.slug is not null
    and v.city = p_city
    and not g.is_seed
    and g.withdrawn_at is null
    and g.starts_at >= p_from
    and g.starts_at < p_to
  order by g.starts_at, g.name;
$$;
