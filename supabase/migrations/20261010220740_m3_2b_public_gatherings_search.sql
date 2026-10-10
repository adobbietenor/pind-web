-- M3.2b — search (designed in M2.3, decisions "A search bar"; built 10 Oct 2026).
--
-- **One door, one predicate.** Search is public_gatherings with a query, not a third
-- function: "on the public web" stays one definition (M2.1, H11), so a search can never
-- return what the list would not — no seed (V18), no draft, nothing withdrawn, nothing
-- from another city (P185). Proved by P191–P192.
--
-- The query narrows by name and venue name, case-insensitive. What someone types is
-- matched literally: % and _ are escaped, so "100%" finds "100%" and "_" is not a
-- wildcard. Trimmed and capped at 100 characters; blank is no query. Searches are never
-- stored or counted (decisions: held for M4.1).
--
-- The span is the caller's: W1's week for the list, every published gathering ahead for
-- a search (Alex, 10 Oct 2026).
--
-- **p_query has no default, on purpose.** Beside the three-argument version, a default
-- would make every three-argument call match both and be refused as ambiguous. Callers
-- pass null for no query. The three-argument version is dropped by a later migration
-- once the Worker and the web app that call this one are deployed — as in M3.3c.

create function public.public_gatherings(p_from timestamptz, p_to timestamptz, p_city text, p_query text)
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
  with q as (
    select nullif(left(btrim(coalesce(p_query, '')), 100), '') as raw
  ), pattern as (
    select case when raw is null then null
      else '%' || replace(replace(replace(raw, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as p
    from q
  )
  select
    g.slug, g.name, g.starts_at, g.ends_at, g.entry, g.door_price_cents, g.entry_note,
    g.category, g.signup_required, g.blurb, g.source,
    v.id, v.name, c.name, c.timezone,
    coalesce(co.pinned, 0), coalesce(co.open_to_meeting, 0), coalesce(co.crews_open, false)
  from public.gatherings g
  join public.venues v on v.id = g.venue_id
  join public.cities c on c.slug = v.city
  cross join pattern
  left join lateral public.gathering_counts(array[g.id]) co on true
  where g.slug is not null
    and v.city = p_city
    and not g.is_seed
    and g.withdrawn_at is null
    and g.starts_at >= p_from
    and g.starts_at < p_to
    and (pattern.p is null or g.name ilike pattern.p or v.name ilike pattern.p)
  order by g.starts_at, g.name;
$$;
