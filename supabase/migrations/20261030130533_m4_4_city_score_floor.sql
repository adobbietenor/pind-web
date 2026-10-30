-- M4.4, after the second score spread (Alex, 30 Oct 2026): the City feed's listings have
-- their own floor on the Community tab, 45. Everything else, Ticketmaster rows on the
-- Community tab included, keeps score_floor (60).
--
-- Why a floor of its own rather than a lower score_floor: the City feed is judged by
-- the Community rubric, which scores on a different scale from the Events one, so the
-- two numbers do not mean the same thing. Farmers' markets scored 42-50 under it and
-- Alex wants them on the tab.

alter table public.cities
  add column city_score_floor smallint not null default 45 check (city_score_floor between 0 and 100);

comment on column public.cities.city_score_floor is
  'The final score a City of Toronto feed listing needs to publish on the Community tab (M4.4). score_floor is everything else.';

-- The settings form saves it like every other setting, and the change is logged.
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
    city_score_floor       = coalesce((p_settings ->> 'city_score_floor')::smallint, city_score_floor),
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
