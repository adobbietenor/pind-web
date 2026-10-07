-- M3.3 — the seventh switch is named after its kind, like the other six.
--
-- The email's stop link (admin_switch_off) and the app's Settings both use the kind's
-- name as the column's. m3_3_after_the_night named the column `invites` for the kind
-- `invite`, so "stop" from an invite email would have failed. N08 now compares every
-- switch column with every kind, so the two cannot part again.
alter table public.notification_settings rename column invites to invite;

create or replace function private.wants(p_person uuid, p_kind public.notification_kind) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_kind
      when 'digest' then s.digest when 'room_open' then s.room_open when 'plan_status' then s.plan_status
      when 'day_of' then s.day_of when 'next_morning' then s.next_morning when 'room_activity' then s.room_activity
      when 'invite' then s.invite end
    from public.notification_settings s where s.person_id = p_person
  ), true);
$$;
