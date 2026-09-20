-- Registering elsewhere, and rooms too small for the product to work in (Alex, before
-- the wider community pass). Two problems that arrive together and are opposites.
--
-- **Registration is a precondition, and the page should say so.** "Pin in" means "I am
-- going" — a statement about the person, not a claim about availability. Someone who
-- has registered with the ride club *is* going, and their pin is true. What was
-- missing is the line above the button telling them to register first. So: still
-- pinnable, with `signup_url`.
--
-- **Capacity is not a caveat, it is a publishing rule.** Crews open at five people
-- opted in, and §7 expects opt-in at about half of pinners — so five opted in needs
-- roughly ten pinners, and **a room that cannot hold ten people cannot produce ten
-- pinners at any conversion rate whatsoever.** That is arithmetic, not a forecast. A
-- birding walk with three places is not a page needing a warning; it is a page the
-- product cannot serve, and publishing it would promise a crew that can never form.
--
-- Ten is therefore the line where reasoning stops and evidence has to start: below it
-- is impossible, above it is a guess about how many attendees ever become pinners,
-- which nothing yet knows. It is a setting on the `cities` row for that reason —
-- it moves with evidence rather than with argument.
--
-- **Places remaining is deliberately not modelled.** "3 spaces left" is true for an
-- hour and then it is a lie on a page we control, which is the same mistake as
-- storing somebody else's opening hours. Capacity is a fact about the room; remaining
-- is a fact about right now, and we cannot keep it.

alter table public.gatherings
  add column signup_url text check (signup_url ~ '^https?://'),
  -- Required with no link is a real state: "register with the organiser first", where
  -- the organiser has no page to send anyone to.
  add column signup_required boolean not null default false,
  add column capacity integer check (capacity > 0);

comment on column public.gatherings.capacity is
  'How many the room holds, where it is known and fixed. Null is unknown, which is not a reason to hold anything back. Places *remaining* is never stored: it is stale within the hour.';

alter table public.cities
  add column min_capacity smallint not null default 10 check (min_capacity >= 0);

comment on column public.cities.min_capacity is
  'A gathering with a known capacity below this is never auto-published: crews open at 5 and opt-in runs at about half of pinners (§7), so a room this small cannot produce enough pinners at any rate. Alex can still publish one by hand.';

-- The settings form writes through this, so it has to know the new name.
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
    community_slots_weekly = coalesce((p_settings ->> 'community_slots_weekly')::smallint, community_slots_weekly),
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
-- The public read paths carry the sign-up line. Capacity does not go out: it is an
-- input to publishing, not something a reader needs, and a number without "remaining"
-- beside it invites exactly the stale promise this avoids.
--
-- Built from the LIVE definition (20260920180803_restore_public_gathering), not from
-- the migration that first created it — which is the mistake that took the map off
-- every crowd page earlier today.
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
