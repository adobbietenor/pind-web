-- Phase 2 M2.2 — the publisher's database actions (spec.md §8).
--
-- The nightly fill itself lives in src/publish/, because its rules are arithmetic
-- over a queue and the milestone asks for unit tests of them. What it may *do* is
-- here: the publisher has no privilege the admin does not, and it publishes by
-- calling the same public.admin_publish_gathering Alex's button calls. There is
-- still exactly one way onto the public web.
--
-- Service key only throughout, like every other admin_* function.

-- ---------------------------------------------------------------------------
-- Alex's mark on a draft. '' or null clears it. Logged like any other decision,
-- so the draft queue can say who marked it and when.
-- ---------------------------------------------------------------------------

create function public.admin_set_publish_mark(p_gathering uuid, p_mark text, p_actor text) returns void
language plpgsql set search_path = '' as $$
declare
  m public.publish_mark;
  g public.gatherings;
begin
  if coalesce(btrim(p_mark), '') = '' then
    m := null;
  elsif p_mark in ('publish', 'never') then
    m := p_mark::public.publish_mark;
  else
    raise exception 'A publish mark is "publish", "never" or nothing';
  end if;

  select * into g from public.gatherings where id = p_gathering for update;
  if not found then raise exception 'Gathering not found'; end if;
  if g.publish_mark is not distinct from m then return; end if;

  update public.gatherings set publish_mark = m where id = p_gathering;
  insert into public.moderation_log (actor, action, gathering_id, note)
  values (p_actor, 'publish_mark', p_gathering, coalesce(g.publish_mark::text, '(none)') || ' -> ' || coalesce(m::text, '(none)'));
end;
$$;

-- ---------------------------------------------------------------------------
-- "We posted this." Recorded by whoever posted it, in the minute they posted it,
-- from the share link in the admin — not reconciled from a list later. Repeat posts
-- to different channels are separate rows; the same channel twice in a minute is
-- almost always a double tap, so it is folded into the existing row.
-- ---------------------------------------------------------------------------

create function public.admin_record_promotion(
  p_gathering uuid, p_channel text, p_note text, p_actor text
) returns uuid
language plpgsql set search_path = '' as $$
declare
  ch  text := btrim(coalesce(p_channel, ''));
  nt  text := nullif(btrim(coalesce(p_note, '')), '');
  id  uuid;
begin
  if char_length(ch) < 1 or char_length(ch) > 60 then
    raise exception 'Say where you posted it (up to 60 characters)';
  end if;
  if not exists (select 1 from public.gatherings where id = p_gathering and published_at is not null) then
    raise exception 'Only a published gathering can be promoted';
  end if;

  select gp.id into id
  from public.gathering_promotions gp
  where gp.gathering_id = p_gathering
    and lower(gp.channel) = lower(ch)
    and gp.promoted_by = p_actor
    and gp.promoted_at > now() - interval '1 minute';
  if found then return id; end if;

  insert into public.gathering_promotions (gathering_id, channel, note, promoted_by)
  values (p_gathering, ch, nt, p_actor)
  returning gathering_promotions.id into id;

  insert into public.moderation_log (actor, action, gathering_id, note)
  values (p_actor, 'promote', p_gathering, ch || coalesce(' — ' || nt, ''));
  return id;
end;
$$;

-- Posted by mistake, or the wrong gathering. Removing the last row makes the
-- gathering organic again, which is the honest thing if it was never posted.
create function public.admin_delete_promotion(p_promotion uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
declare
  gp public.gathering_promotions;
begin
  delete from public.gathering_promotions where id = p_promotion returning * into gp;
  if not found then raise exception 'No such promotion'; end if;
  insert into public.moderation_log (actor, action, gathering_id, note)
  values (p_actor, 'promote_undo', gp.gathering_id, gp.channel);
end;
$$;

-- ---------------------------------------------------------------------------
-- What the weekly adjust measures: every gathering whose effective end falls in
-- the trailing window, with the counts as of now.
--
-- The counts mirror public.gathering_counts exactly — pinned is the sum of
-- party_total, open_to_meeting counts distinct people who opted in and are not
-- hidden, and five is five in one place only — because the adjust and the admin
-- must never be able to disagree about whether a gathering reached the threshold.
--
-- It reads live pins, which is exact while the window stays under the 30-day pin
-- retention (decisions Part 3); the column comment on cities.adjust_window_days and
-- the assertion in src/publish/plan.ts are the two guards on that. M4.5 repoints
-- this body at gathering_stats and compares the two on the same weeks, which is why
-- publish_target_log keeps every row this returns.
--
-- Withdrawn gatherings are left out: withdrawn means the gathering was off, not
-- that it failed to gather anyone. Seed rows are left out everywhere (V18).
-- ---------------------------------------------------------------------------

create function public.admin_publish_outcomes(p_city text, p_days integer) returns jsonb
language sql stable set search_path = '' as $$
  with ended as (
    select g.id, g.name, g.starts_at, public.effective_end(g) as ended_at,
           g.published_at, g.publish_mark, v.id as venue_id, v.name as venue_name
    from public.gatherings g
    join public.venues v on v.id = g.venue_id
    where v.city = p_city
      and g.published_at is not null
      and g.withdrawn_at is null
      and not g.is_seed
      and public.effective_end(g) < now()
      and public.effective_end(g) >= now() - make_interval(days => greatest(p_days, 0))
  ),
  counted as (
    select e.*,
      (select coalesce(sum(pi.party_total), 0) from public.pins pi where pi.gathering_id = e.id)::integer as pinned,
      (select count(*) from public.pins pi
         join public.people pe on pe.id = pi.person_id
        where pi.gathering_id = e.id and pi.open_to_meeting and pe.hidden_at is null)::integer as open_to_meeting,
      exists (select 1 from public.gathering_promotions gp where gp.gathering_id = e.id) as promoted
    from ended e
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.starts_at), '[]'::jsonb)
  from (select c.*, c.open_to_meeting >= 5 as reached from counted c) r;
$$;

-- ---------------------------------------------------------------------------
-- The settings. One function so a change is logged with the admin's email: the
-- target is the single number that decides how much of the city a stranger sees,
-- and "who moved it to 9" has to be answerable. The check constraints on cities do
-- the validating; this only names the fields that may move.
-- ---------------------------------------------------------------------------

create function public.admin_save_publish_settings(p_city text, p_settings jsonb, p_actor text) returns void
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

-- The weekly adjust moving the target. Separate from the settings form so the log
-- shows plainly which changes were Alex's and which were the loop's, and clamped
-- here as well as in the planner: the floor is what stops the city's list
-- disappearing after a bad fortnight, so it is enforced where the write happens.
create function public.admin_apply_publish_target(p_city text, p_target smallint, p_actor text) returns smallint
language plpgsql set search_path = '' as $$
declare
  c public.cities;
  clamped smallint;
begin
  select * into c from public.cities where slug = p_city for update;
  if not found then raise exception 'No such city'; end if;
  clamped := greatest(c.publish_min, least(c.publish_max, p_target));
  if clamped = c.publish_target_weekly then return clamped; end if;
  update public.cities set publish_target_weekly = clamped where slug = p_city;
  insert into public.moderation_log (actor, action, note)
  values (p_actor, 'publish_target', format('%s -> %s (%s)', c.publish_target_weekly, clamped, p_city));
  return clamped;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service key only. Supabase grants execute on new functions to anon and
-- authenticated by default, so revoke explicitly (as in M1.2).
-- ---------------------------------------------------------------------------

revoke execute on function
  public.admin_set_publish_mark(uuid, text, text),
  public.admin_record_promotion(uuid, text, text, text),
  public.admin_delete_promotion(uuid, text),
  public.admin_publish_outcomes(text, integer),
  public.admin_save_publish_settings(text, jsonb, text),
  public.admin_apply_publish_target(text, smallint, text)
  from public, anon, authenticated;

grant execute on function
  public.admin_set_publish_mark(uuid, text, text),
  public.admin_record_promotion(uuid, text, text, text),
  public.admin_delete_promotion(uuid, text),
  public.admin_publish_outcomes(text, integer),
  public.admin_save_publish_settings(text, jsonb, text),
  public.admin_apply_publish_target(text, smallint, text)
  to service_role;
