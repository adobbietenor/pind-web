-- M3.2 — the week's list says "not a seed" itself, instead of borrowing it (found by P96).
--
-- The testers migration (20260923132900) said the public doors "keep their own
-- `not is_seed`". That was true of `public_gathering` and **not** of
-- `public_gatherings`: it is a security-invoker function with no seed condition of its
-- own, and it excluded seed gatherings only because the `gatherings` row policy did.
-- Once that policy let testers see the seed gathering, a tester calling the week's
-- list got it back. P96 caught it on its first run.
--
-- Public pages were never exposed — the Worker calls with no session, and
-- `i_am_tester()` is false without one — but a public door must not depend on who is
-- asking. So the list now carries the rule itself, like `public_gathering` always did.
-- Identical to 20260920235000_m2_3_blurbs.sql's definition apart from that one line.

create or replace function public.public_gatherings(p_from timestamptz, p_to timestamptz)
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
    and not g.is_seed
    and g.withdrawn_at is null
    and g.starts_at >= p_from
    and g.starts_at < p_to
  order by g.starts_at, g.name;
$$;
