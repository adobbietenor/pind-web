-- The category a reader will filter by (M2.3's schema step, taken early for the
-- manual community pass — Alex, after M2.2).
--
-- The publisher has been deriving a coarse kind from the Ticketmaster classification
-- since M2.2, which works for imported rows and returns "other" for everything else.
-- A hand-entered run club would therefore have landed in "other" and shown under no
-- chip at all, which would make the community pass fill the list without filling the
-- thing it was for.
--
-- So the category becomes a column, and stays **nullable on purpose**: null means
-- "nobody has said", and the publisher falls back to deriving it from the source.
-- Only rows somebody actually classified carry a value, which keeps a guess and a
-- statement distinguishable — the same distinction as unset versus broken, and as an
-- unknown door price versus free.
--
-- The five names are the ones the chips will use (Alex, M2.2): sports, concerts,
-- bars, clubs, community. Two of them have no source until M4.4; that is a sourcing
-- problem, not a reason to name them differently here.

create type public.gathering_category as enum ('sports', 'concerts', 'bars', 'clubs', 'community');

alter table public.gatherings add column category public.gathering_category;

comment on column public.gatherings.category is
  'What a reader filters by. Null means nobody has said, and the publisher derives a coarse kind from the source instead. Set by hand in the admin; M2.3 decides whether the importer fills it.';

-- Cheap, and the chips will read it on every public list.
create index gatherings_category_idx on public.gatherings (category) where category is not null;

-- ---------------------------------------------------------------------------
-- The public read paths carry it, so a chip can filter without a second query.
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

-- ---------------------------------------------------------------------------
-- Repeating gatherings, entered once
--
-- There is no recurrence in this schema and this does not add one. A crew meets on a
-- night, not on a series: pins, crews, counts, slugs, the publisher's per-week
-- counting and the weekly adjust are all per-row, so the dated rows have to exist
-- whatever model sits above them. What was missing was only the typing — a Saturday
-- run club is thirteen rows a quarter by hand, which is not sustainable and was worth
-- knowing before the community pass started (Alex).
--
-- So this is a generator, honestly named: one form, N dated drafts, each an ordinary
-- gathering from the moment it exists. Nothing downstream can tell they were made
-- together, which is the point — there is no new state to reason about.
-- ---------------------------------------------------------------------------

create function public.admin_create_weekly_series(
  p_template jsonb,
  p_until date,
  p_actor text
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  first_start timestamptz;
  tz          text;
  ids         uuid[] := '{}';
  new_id      uuid;
  at          timestamptz;
  ends_gap    interval;
  n           integer := 0;
begin
  first_start := (p_template ->> 'starts_at')::timestamptz;
  if first_start is null then raise exception 'A series needs a first date'; end if;
  if p_until is null then raise exception 'A series needs a date to repeat until'; end if;

  select c.timezone into tz
  from public.venues v join public.cities c on c.slug = v.city
  where v.id = (p_template ->> 'venue_id')::uuid;
  tz := coalesce(tz, 'America/Toronto');

  -- A quarter of a weekly gathering is thirteen rows; the ceiling is a guard against
  -- a typo in the end date, not a limit anyone should meet.
  if p_until > ((first_start at time zone tz)::date + 400) then
    raise exception 'That repeats for more than a year. Enter a nearer end date.';
  end if;

  ends_gap := case
    when p_template ? 'ends_at' and (p_template ->> 'ends_at') is not null
    then (p_template ->> 'ends_at')::timestamptz - first_start
  end;

  at := first_start;
  while (at at time zone tz)::date <= p_until loop
    insert into public.gatherings (
      name, starts_at, ends_at, venue_id, venue_name_raw, event_url,
      entry, door_price_cents, entry_note, category, featured, source
    ) values (
      p_template ->> 'name',
      at,
      case when ends_gap is not null then at + ends_gap end,
      (p_template ->> 'venue_id')::uuid,
      p_template ->> 'venue_name_raw',
      p_template ->> 'event_url',
      coalesce((p_template ->> 'entry')::public.entry_kind, 'ticketed'),
      (p_template ->> 'door_price_cents')::integer,
      p_template ->> 'entry_note',
      (p_template ->> 'category')::public.gathering_category,
      coalesce((p_template ->> 'featured')::boolean, false),
      'manual'
    )
    returning id into new_id;

    ids := ids || new_id;
    n := n + 1;
    -- Seven days in the venue's own timezone, so a run club stays at 8am across the
    -- daylight-saving change rather than drifting to 7 or 9.
    at := ((at at time zone tz) + interval '7 days') at time zone tz;
  end loop;

  if n = 0 then raise exception 'That end date is before the first gathering'; end if;

  insert into public.moderation_log (actor, action, note)
  values (p_actor, 'series_create', format('%s — %s drafts, weekly until %s', p_template ->> 'name', n, p_until));

  return jsonb_build_object('created', n, 'ids', to_jsonb(ids));
end;
$$;

revoke execute on function public.admin_create_weekly_series(jsonb, date, text) from public, anon, authenticated;
grant execute on function public.admin_create_weekly_series(jsonb, date, text) to service_role;
