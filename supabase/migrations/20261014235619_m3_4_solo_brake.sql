-- M3.4 (A28, A29): the 1-on-1 brake, held by the database (Alex, 14 Oct 2026; decisions,
-- "M3.4: the brake and ending every plan").
--
-- The per-platform switch (app_switches) only hides screens: the database cannot tell which
-- platform asks, so it is cosmetic, never a safety control. The brake is the safety control,
-- and H11 puts it here:
--   - pulled, can_see_solo answers no for every pair, so every 1-on-1 list is empty for
--     every client, and propose_solo / respond_to_solo refuse (both go through it);
--   - received proposals drop out of the recipient's list; the sender's card still says
--     "Sent", which is true;
--   - plans already made stand. Ending them is its own decision, admin_end_all_solo_plans —
--     "the brake is for 'this looks wrong'; the dissolve is for 'something happened'";
--   - open proposals stay as they are, so lifting the brake brings back those whose
--     gathering has not started;
--   - a #8 that would have gone out while the brake was on is DROPPED, never held for when
--     it lifts (a late push about a proposal that may be about to expire is noise).
-- Both admin actions are logged.

create table private.solo_brake (
  id          boolean primary key default true check (id),
  pulled      boolean not null default false,
  pulled_at   timestamptz,
  changed_at  timestamptz not null default now()
);
comment on table private.solo_brake is
  'The 1-on-1 brake (M3.4). One row. Pulled, can_see_solo is false for everyone. Set only by admin_set_solo_brake.';
revoke all on private.solo_brake from public, anon, authenticated;
insert into private.solo_brake default values;

create function private.solo_brake_pulled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select b.pulled from private.solo_brake b), false);
$$;
revoke all on function private.solo_brake_pulled() from public;
grant execute on function private.solo_brake_pulled() to authenticated;

-- For the app to hide the switch and section (presentation; the rule below is the control).
create function public.solo_available() returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.solo_brake_pulled();
$$;
revoke all on function public.solo_available() from public;
grant execute on function public.solo_available() to anon, authenticated;

-- The rule, with the brake first.
create or replace function private.can_see_solo(p_target uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select not private.solo_brake_pulled()
       and private.can_see_at(p_target, p_gathering)
       and mine is not null
       and theirs is not null
       and not exists (
         select 1 from public.people pe where pe.id in (me.id, p_target) and pe.hidden_from_solo
       )
       and (mine = 'everyone' or private.is_women_only_eligible(p_target))
       and (theirs = 'everyone' or private.is_women_only_eligible(me.id))
       and not private.in_solo_plan(me.id, p_gathering)
       and not private.in_solo_plan(p_target, p_gathering)
    from (select private.me() as id) me
    cross join lateral (select private.solo_choice(me.id, p_gathering) as mine) a
    cross join lateral (select private.solo_choice(p_target, p_gathering) as theirs) b
    where me.id is not null
  ), false);
$$;

-- Drops every unsent #8, marked sent to nowhere with the reason, so it is final and the
-- delivery job never picks it up again. Run on the pull (what is queued) and again on the
-- lift: anything still unsent then was made while the brake was on, by a proposal racing
-- the pull, and would otherwise go out late.
create function private.drop_braked_solo_notifications() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.notifications n
  set sent_at = now(), channel = 'none', last_error = 'dropped: the 1-on-1 brake was pulled'
  where n.kind = 'solo_proposal' and n.sent_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.drop_braked_solo_notifications() from public;

create function public.admin_set_solo_brake(p_pulled boolean, p_actor text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_dropped integer;
begin
  update private.solo_brake
  set pulled = p_pulled,
      pulled_at = case when p_pulled then now() else pulled_at end,
      changed_at = now();
  v_dropped := private.drop_braked_solo_notifications();
  insert into public.moderation_log (actor, action, note)
  values (p_actor, case when p_pulled then 'solo_brake_pulled' else 'solo_brake_lifted' end,
          v_dropped || ' proposal notification(s) dropped');
  return v_dropped;
end;
$$;
revoke all on function public.admin_set_solo_brake(boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_solo_brake(boolean, text) to service_role;

create function public.admin_solo_brake() returns table (pulled boolean, pulled_at timestamptz, changed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.pulled, b.pulled_at, b.changed_at from private.solo_brake b;
$$;
revoke all on function public.admin_solo_brake() from public, anon, authenticated;
grant execute on function public.admin_solo_brake() to service_role;

-- "Something happened": every set or live 1-on-1 plan ends, and both people in each are
-- told "Your 1-on-1 for X is off", hidden or not (as H9's ending: "both people"). Separate
-- from the brake; neither does the other. Logged with the count.
create function public.admin_end_all_solo_plans(p_actor text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_crew uuid;
  v_n integer := 0;
begin
  for v_crew in
    select c.id from public.crews c where c.kind = 'solo' and c.state in ('spot_set', 'live') for update
  loop
    perform private.dissolve_solo(v_crew, true);
    v_n := v_n + 1;
  end loop;
  insert into public.moderation_log (actor, action, note)
  values (p_actor, 'solo_end_all_plans', v_n || ' plan(s) ended');
  return v_n;
end;
$$;
revoke all on function public.admin_end_all_solo_plans(text) from public, anon, authenticated;
grant execute on function public.admin_end_all_solo_plans(text) to service_role;

-- The delivery query, as m3_3c, never picking a #8 while the brake is pulled. Not a hold:
-- the lift drops whatever is still unsent.
create or replace function public.admin_pending_notifications(p_limit integer default 100)
returns table (id uuid, person_id uuid, kind public.notification_kind, title text, body text, path text, attempts smallint,
               tokens text[], email text)
language sql stable security definer set search_path = '' as $$
  select n.id, n.person_id, n.kind, n.title, n.body, n.path, n.attempts,
    case when private.is_harness_user(p.auth_user_id) or p.is_seed then '{}'::text[]
         else array(select d.token from public.device_tokens d where d.person_id = n.person_id order by d.last_seen_at desc) end,
    case when private.is_harness_user(p.auth_user_id) or p.is_seed then null
         else (select u.email::text from auth.users u where u.id = p.auth_user_id and not coalesce(u.is_anonymous, false)) end
  from public.notifications n
  join public.people p on p.id = n.person_id
  where n.sent_at is null and n.attempts < 3
    and not (n.kind = 'solo_proposal' and private.solo_brake_pulled())
  order by n.created_at
  limit p_limit;
$$;
