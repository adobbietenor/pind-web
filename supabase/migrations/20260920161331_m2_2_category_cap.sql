-- Phase 2 M2.2 — the score floor drops to 60, and no one kind of gathering may take
-- more than its share of a week (Alex, M2.2).
--
-- These two are one change, not two. Measured on the real Toronto queue:
--
--   floor 70 -> 88 eligible drafts over 8 weeks (~11/week): clubs 31, concerts 29, sports 28
--   floor 60 -> 223                      (~28/week): concerts 130, clubs 59, sports 30
--   floor 50 -> 424                      (~53/week): concerts 287, clubs 77, sports 48
--
-- Lowering the floor is the only lever that actually widens the list, and on its own
-- it turns a list that is meant to say "going out in Toronto" into a concert listing.
-- Alex's call, in his words: "28 a week with a real mix beats 53 a week of concerts."
-- So the floor moves to 60 and the cap lands in the same migration; neither is
-- correct without the other.
--
-- The cap is a *share of what is being published*, not a fixed count, because the
-- queue is short: a fixed count worked out from the target of 50 would never bind at
-- 28 a week, which is exactly when the crowding happens. Walking the week's ranking,
-- a draft is skipped when publishing it would push its category past the share — with
-- a small allowance first, so the opening picks are not all blocked by a rule about
-- proportions of one.

alter table public.cities
  add column max_category_share numeric(3, 2) not null default 0.40
    check (max_category_share > 0 and max_category_share <= 1),
  -- Every category may take this many in a week before the share applies at all.
  -- Without it the first pick would be 100% of one category and nothing could start.
  add column min_per_category smallint not null default 3
    check (min_per_category between 1 and 50);

comment on column public.cities.max_category_share is
  'No one category takes more than this share of a week''s published gatherings, once min_per_category is exceeded. The rule that makes a lower score_floor safe (M2.2).';

-- The floor Alex chose alongside the cap.
update public.cities set score_floor = 60 where slug = 'toronto';

-- The publishing log says which category a choice belonged to, so "concerts were
-- full" reads as a fact rather than as an assertion.
alter table public.publish_decisions add column category text;

comment on column public.publish_decisions.category is
  'The coarse kind of gathering the cap reasoned about. Provisional in M2.2, derived from the source classification; M2.3 promotes it to a column on gatherings with the public naming.';

-- The settings form writes through this function, so it has to know the new names.
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
