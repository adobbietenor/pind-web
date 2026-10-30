-- M4.4: community sources (Alex, 29 Oct 2026, from the community pipeline diagnosis).
--
-- The Community tab had one source — 28 series entered by hand — and nothing that
-- topped them up, so it shrank to the same nine places. This migration is the data
-- half of five changes Alex chose:
--
--   1. the City of Toronto's Festivals & Events feed is a source (the 'city' value,
--      the previous migration), through the publisher like every imported source;
--   2. a confirmed series is topped up (no schema: the job inserts drafts);
--   3. a weekly cap per venue and per organiser on the Community tab, hand-entered
--      series included;
--   4. Ticketmaster's fairs, expos and food & drink go to Community, not Events;
--   5. a multi-day festival is one gathering per day (no schema: the importers).
--
-- And, from the build's own question: **Community has its own fill** (Alex). The
-- 50-a-week target is the Events tab's; Community rows neither count towards it nor
-- wait on it. The community slot that was meant to bridge them looked for
-- source = 'community', a value the enum never had, so it never fired — it goes.

-- ---------------------------------------------------------------------------
-- 1 · Which tab a gathering is listed on
--
-- It used to be read off `source` (Ticketmaster = Events, everything else =
-- Community). Change 4 breaks that: a Ticketmaster food festival is Community. So it
-- is a column, set when the row is made, from the source — and for a Ticketmaster
-- listing, from its own classification, by admin_tab_gatherings below.
-- ---------------------------------------------------------------------------

create type public.list_tab as enum ('events', 'community');

alter table public.gatherings add column tab public.list_tab;
update public.gatherings
set tab = (case when source = 'ticketmaster' then 'events' else 'community' end)::public.list_tab;
alter table public.gatherings alter column tab set not null;

comment on column public.gatherings.tab is
  'The W1 tab (and the app list tab) this gathering is listed on. Set from the source when the row is made; a Ticketmaster listing moves to Community only while it has never been public, by its own classification (admin_tab_gatherings). The publisher fills each tab by its own rules.';

-- Every insert that does not say gets the tab its source implies. A before-insert
-- trigger rather than a column default because the default depends on another column.
create function public.gatherings_default_tab() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tab is null then
    new.tab := (case when new.source = 'ticketmaster' then 'events' else 'community' end)::public.list_tab;
  end if;
  return new;
end;
$$;

create trigger gatherings_default_tab
  before insert on public.gatherings
  for each row execute function public.gatherings_default_tab();

-- The four Ticketmaster genres that are Community, named exactly as Ticketmaster's
-- own classification endpoint names them under Miscellaneous (checked 29 Oct 2026).
-- The import stores a listing's classification as "Segment / Genre". Everything else
-- Ticketmaster lists is Events, including the rest of Miscellaneous: its genre-less
-- rows are mostly club nights and parties (Alex chose named genres over the segment).
create function public.tab_for_classification(p_classification text) returns public.list_tab
language sql immutable set search_path = '' as $$
  select (case
    when p_classification in (
      'Miscellaneous / Fairs & Festivals',
      'Miscellaneous / Food & Drink',
      'Miscellaneous / Hobby/Special Interest Expos',
      'Miscellaneous / Community/Civic'
    ) then 'community'
    else 'events'
  end)::public.list_tab;
$$;

comment on function public.tab_for_classification(text) is
  'The tab a Ticketmaster listing belongs on, from its stored "Segment / Genre". Fairs & festivals, food & drink, hobby expos and community/civic are Community; the rest is Events.';

-- Moves Ticketmaster rows to the tab their classification implies — only while they
-- have never been public (no slug). A published gathering does not jump tabs because
-- Ticketmaster re-filed it; the same "set before publication, never after" shape as
-- the chip (admin_categorise_gatherings).
create function public.admin_tab_gatherings() returns integer
language plpgsql set search_path = '' as $$
declare
  n integer;
begin
  update public.gatherings g
  set tab = public.tab_for_classification(x.classification)
  from (
    select gs.gathering_id, min(gs.snapshot ->> 'category') as classification
    from public.gathering_sources gs
    where gs.source = 'ticketmaster'
    group by gs.gathering_id
  ) x
  where x.gathering_id = g.id
    and g.source = 'ticketmaster'
    and g.slug is null
    and g.tab is distinct from public.tab_for_classification(x.classification);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.admin_tab_gatherings() from public, anon, authenticated;
grant execute on function public.admin_tab_gatherings() to service_role;
revoke execute on function public.tab_for_classification(text) from public, anon, authenticated;
grant execute on function public.tab_for_classification(text) to service_role;

select public.admin_tab_gatherings();

-- ---------------------------------------------------------------------------
-- 2 · Who runs it
--
-- The per-organiser cap needs an organiser, and nothing recorded one. A series has
-- one (Alex approved filling the 28 by hand, below); a gathering carries its own copy
-- so the publisher reads one row, and the City feed sets it from the listing's own
-- "presented by", or failing that its contact address. Null is capped by venue only.
-- ---------------------------------------------------------------------------

alter table public.community_series
  add column organiser text check (organiser is null or btrim(organiser) <> '');
alter table public.gatherings
  add column organiser text check (organiser is null or btrim(organiser) <> '');

comment on column public.gatherings.organiser is
  'Who runs it, for the Community tab''s per-organiser weekly cap. Copied from the series for hand-entered rows; from "presented by" or the contact address for the City feed. Null is capped by venue only.';

-- The 28 hand-entered series. Grouped where one organisation runs several (by the page
-- each series is checked against); otherwise the series is its own organiser. Library
-- programmes are grouped by branch, not as "Toronto Public Library": one branch is
-- one group of people, and the whole library system is not one group.
update public.community_series set organiser = case
  when label like 'Frontrunners Toronto%' then 'Frontrunners Toronto'
  when url like '%snakesandlattes.com%' then 'Snakes & Lattes'
  when url like 'https://tbn.ca/%' then 'Toronto Bicycling Network'
  when url like 'https://torontobirding.ca/%' then 'Toronto Ornithological Club'
  when label like '%Port Union Library' then 'Port Union Library'
  when label like '%Kennedy/Eglinton Library' then 'Kennedy/Eglinton Library'
  when url like '%meetup.com/pub-chess-toronto%' then 'Pub Chess Toronto'
  else label
end
where organiser is null;

update public.gatherings g
set organiser = s.organiser
from public.community_series s
where g.series_id = s.id and g.organiser is null;

-- ---------------------------------------------------------------------------
-- 3 · The Community tab's caps, and the hold on the City feed
-- ---------------------------------------------------------------------------

alter table public.cities
  add column community_max_per_venue_weekly smallint not null default 2
    check (community_max_per_venue_weekly between 1 and 50),
  add column community_max_per_organiser_weekly smallint not null default 2
    check (community_max_per_organiser_weekly between 1 and 50),
  -- Off until Alex has seen the City listings' score spread (his condition, 29 Oct):
  -- the feed imports and is scored, and the publisher refuses its rows, saying why.
  add column city_feed_publishing boolean not null default false;

comment on column public.cities.community_max_per_venue_weekly is
  'At most this many Community-tab gatherings at one venue in one city-local week (Alex: 2). Hand-entered series included.';
comment on column public.cities.community_max_per_organiser_weekly is
  'At most this many Community-tab gatherings by one organiser in one city-local week (Alex: 2). A null organiser is capped by venue only.';
comment on column public.cities.city_feed_publishing is
  'Whether the publisher may publish City of Toronto feed rows. Off until Alex has seen their scores.';

alter table public.cities drop column community_slots_weekly;

-- Rebuilt from the live definition (20260920183930_signup_and_capacity), with the
-- dead slot removed and the three new settings added.
create or replace function public.admin_save_publish_settings(p_city text, p_settings jsonb, p_actor text) returns void
language plpgsql set search_path = '' as $$
declare
  before public.cities;
  changed text;
begin
  select * into before from public.cities where slug = p_city for update;
  if not found then raise exception 'No such city'; end if;

  update public.cities set
    publish_target_weekly  = coalesce((p_settings ->> 'publish_target_weekly')::smallint, publish_target_weekly),
    publish_min            = coalesce((p_settings ->> 'publish_min')::smallint, publish_min),
    publish_max            = coalesce((p_settings ->> 'publish_max')::smallint, publish_max),
    publish_lead_days_min  = coalesce((p_settings ->> 'publish_lead_days_min')::smallint, publish_lead_days_min),
    publish_lead_days_max  = coalesce((p_settings ->> 'publish_lead_days_max')::smallint, publish_lead_days_max),
    max_per_venue_per_week = coalesce((p_settings ->> 'max_per_venue_per_week')::smallint, max_per_venue_per_week),
    max_category_share     = coalesce((p_settings ->> 'max_category_share')::numeric, max_category_share),
    min_per_category       = coalesce((p_settings ->> 'min_per_category')::smallint, min_per_category),
    min_capacity           = coalesce((p_settings ->> 'min_capacity')::smallint, min_capacity),
    community_max_per_venue_weekly =
      coalesce((p_settings ->> 'community_max_per_venue_weekly')::smallint, community_max_per_venue_weekly),
    community_max_per_organiser_weekly =
      coalesce((p_settings ->> 'community_max_per_organiser_weekly')::smallint, community_max_per_organiser_weekly),
    city_feed_publishing   = coalesce((p_settings ->> 'city_feed_publishing')::boolean, city_feed_publishing),
    score_floor            = coalesce((p_settings ->> 'score_floor')::smallint, score_floor),
    grow_reach             = coalesce((p_settings ->> 'grow_reach')::numeric, grow_reach),
    grow_median_pins       = coalesce((p_settings ->> 'grow_median_pins')::smallint, grow_median_pins),
    shrink_reach           = coalesce((p_settings ->> 'shrink_reach')::numeric, shrink_reach),
    step_up                = coalesce((p_settings ->> 'step_up')::smallint, step_up),
    step_down              = coalesce((p_settings ->> 'step_down')::smallint, step_down),
    adaptive               = coalesce((p_settings ->> 'adaptive')::boolean, adaptive),
    adjust_window_days     = coalesce((p_settings ->> 'adjust_window_days')::smallint, adjust_window_days),
    adjust_min_lead_days   = coalesce((p_settings ->> 'adjust_min_lead_days')::smallint, adjust_min_lead_days),
    adjust_min_gatherings  = coalesce((p_settings ->> 'adjust_min_gatherings')::smallint, adjust_min_gatherings)
  where slug = p_city;

  select string_agg(format('%s %s -> %s', key, coalesce(was, '(null)'), coalesce(now_value, '(null)')), ', ' order by key)
  into changed
  from (
    select b.key, b.value #>> '{}' as was, a.value #>> '{}' as now_value
    from jsonb_each(to_jsonb(before)) b
    join jsonb_each(to_jsonb((select c from public.cities c where c.slug = p_city))) a using (key)
    where b.value is distinct from a.value
  ) d;

  if changed is null then return; end if;
  insert into public.moderation_log (actor, action, note) values (p_actor, 'publish_settings', changed);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4 · The public list says which tab
--
-- Rebuilt from the live definition (20261010220740_m3_2b_public_gatherings_search),
-- with one column added at the end. Same predicate, same order. P65 names it.
-- ---------------------------------------------------------------------------

drop function public.public_gatherings(timestamptz, timestamptz, text, text);

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
  crews_open       boolean,
  tab              public.list_tab
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
    coalesce(co.pinned, 0), coalesce(co.open_to_meeting, 0), coalesce(co.crews_open, false),
    g.tab
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

-- The City feed's runs share import_runs (and so its lock and the day's AI spend) but
-- not its trigger names: the watchdog and the admin's "last import" read 'cron' and
-- 'manual' as the Ticketmaster import, and a City run must never satisfy them.
alter table public.import_runs drop constraint import_runs_trigger_check;
alter table public.import_runs
  add constraint import_runs_trigger_check
  check (trigger in ('cron', 'manual', 'suggest', 'watchdog', 'city-cron', 'city-manual'));

-- ---------------------------------------------------------------------------
-- 5 · Applying a night of the City feed
--
-- The importer plans (src/import/cityfeed.ts, pure and tested); this applies, in one
-- transaction, and refuses what the importer may not do — the same split as
-- admin_import_apply. Drafts only are ever changed. A listing that has left the feed
-- dismisses its draft (logged as the importer, restorable only by the importer, as
-- Ticketmaster's); a published one gets a "missing" flag for Alex and nothing else.
-- ---------------------------------------------------------------------------

create function public.admin_city_import_apply(p_run bigint, p_plan jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  c_actor constant text := 'importer:city';
  v_city text;
  new_venue_ids jsonb := '{}';
  nv record;
  d jsonb;
  r record;
  gid uuid;
  vid uuid;
  last_actor text;
  last_action text;
  n_venues int := 0;
  n_new int := 0;
  n_seen int := 0;
  n_dismissed int := 0;
  n_restored int := 0;
  n_flagged int := 0;
begin
  select city into v_city from public.import_runs where id = p_run and status = 'running' and source = 'city';
  if not found then raise exception 'Not a running City feed import'; end if;

  -- New places, with the feed's own coordinates, remembered by the feed's own
  -- name-and-address key so the next night finds them.
  for nv in
    select * from jsonb_to_recordset(coalesce(p_plan -> 'newVenues', '[]'))
      as x(key text, name text, address text, lat double precision, lng double precision)
  loop
    select e.venue_id into vid from public.venue_external_ids e where e.source = 'city' and e.external_id = nv.key;
    if vid is null then
      insert into public.venues (name, address, latitude, longitude, city)
      values (btrim(nv.name), nullif(btrim(nv.address), ''), nv.lat, nv.lng, v_city)
      returning id into vid;
      insert into public.venue_external_ids (source, external_id, venue_id, needs_review)
      values ('city', nv.key, vid, true);
      n_venues := n_venues + 1;
    end if;
    new_venue_ids := new_venue_ids || jsonb_build_object(nv.key, vid);
    vid := null;
  end loop;

  -- A known venue matched by name: remember the feed's key for it.
  insert into public.venue_external_ids (source, external_id, venue_id)
  select 'city', x.key, x."venueId"
  from jsonb_to_recordset(coalesce(p_plan -> 'venueKeys', '[]')) as x(key text, "venueId" uuid)
  on conflict (source, external_id) do nothing;

  -- New drafts. A listing-day already known is never a second copy.
  for d in select * from jsonb_array_elements(coalesce(p_plan -> 'newDrafts', '[]'))
  loop
    if exists (select 1 from public.gathering_sources gs where gs.source = 'city' and gs.external_id = d ->> 'externalId') then
      continue;
    end if;
    insert into public.gatherings (
      name, starts_at, ends_at, venue_id, event_url, source, tab, category, entry, organiser
    ) values (
      d ->> 'name',
      (d ->> 'startsAt')::timestamptz,
      (d ->> 'endsAt')::timestamptz,
      coalesce((d ->> 'venueId')::uuid, (new_venue_ids ->> (d ->> 'venueKey'))::uuid),
      d ->> 'eventUrl',
      'city',
      'community',
      (d ->> 'category')::public.gathering_category,
      coalesce((d ->> 'entry')::public.entry_kind, 'ticketed'),
      nullif(btrim(d ->> 'organiser'), '')
    )
    returning id into gid;
    insert into public.gathering_sources (gathering_id, source, external_id, urls, snapshot)
    values (
      gid, 'city', d ->> 'externalId',
      case when d ->> 'eventUrl' is null then '{}'::text[] else array[d ->> 'eventUrl'] end,
      d -> 'snapshot'
    );
    n_new := n_new + 1;
  end loop;

  -- Seen again tonight.
  update public.gathering_sources gs
  set snapshot = x.snapshot, last_seen_at = now(), missing_since = null
  from jsonb_to_recordset(coalesce(p_plan -> 'seen', '[]')) as x("externalId" text, snapshot jsonb)
  where gs.source = 'city' and gs.external_id = x."externalId";
  get diagnostics n_seen = row_count;

  -- Seen again after the importer dismissed it: back to a draft. Alex's dismissals stay.
  for r in
    select gs.gathering_id
    from public.gathering_sources gs
    join public.gatherings g on g.id = gs.gathering_id
    where gs.source = 'city'
      and gs.external_id in (select x ->> 'externalId' from jsonb_array_elements(coalesce(p_plan -> 'seen', '[]')) x)
      and g.dismissed_at is not null and g.merged_into_id is null
  loop
    select l.actor, l.action into last_actor, last_action
    from public.moderation_log l
    where l.gathering_id = r.gathering_id and l.action in ('dismiss', 'restore', 'merge')
    order by l.at desc, l.id desc
    limit 1;
    if last_actor = c_actor and last_action = 'dismiss' then
      update public.gatherings set dismissed_at = null where id = r.gathering_id;
      insert into public.moderation_log (actor, action, gathering_id, note)
      values (c_actor, 'restore', r.gathering_id, 'The City feed lists it again');
      n_restored := n_restored + 1;
    end if;
  end loop;

  -- Gone from a complete read of the feed, and still to come. Only a complete read
  -- may say something is gone: a feed that broke halfway would otherwise dismiss
  -- everything after the break.
  if (p_plan ->> 'complete')::boolean then
    for r in
      select gs.gathering_id, g.published_at
      from public.gathering_sources gs
      join public.gatherings g on g.id = gs.gathering_id
      where gs.source = 'city'
        and g.starts_at > now()
        and g.dismissed_at is null
        and g.withdrawn_at is null
        and gs.external_id not in (select jsonb_array_elements_text(coalesce(p_plan -> 'seenIds', '[]')))
    loop
      update public.gathering_sources set missing_since = coalesce(missing_since, now())
      where gathering_id = r.gathering_id and source = 'city';
      if r.published_at is null then
        update public.gatherings set dismissed_at = now() where id = r.gathering_id and dismissed_at is null;
        insert into public.moderation_log (actor, action, gathering_id, note)
        values (c_actor, 'dismiss', r.gathering_id, 'City feed: no longer listed');
        n_dismissed := n_dismissed + 1;
      else
        insert into public.gathering_flags (gathering_id, kind, source, status)
        values (r.gathering_id, 'missing', 'city', 'no longer listed')
        on conflict (gathering_id, kind) where resolved_at is null do update set updated_at = now();
        n_flagged := n_flagged + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'venues_created', n_venues, 'new', n_new, 'seen', n_seen,
    'dismissed', n_dismissed, 'restored', n_restored, 'flagged', n_flagged
  );
end;
$$;

revoke execute on function public.admin_city_import_apply(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.admin_city_import_apply(bigint, jsonb) to service_role;
