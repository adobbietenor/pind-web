-- Phase 1 M1.1 — auto-hide on report (H9, docs/visibility.md V10).
--
-- Severity derives from the reason, never from the reporter:
--   - a safety reason (uncomfortable, under_19 → is_safety) hides the target at once;
--   - not_who_they_said / spam hide it at reports from two DIFFERENT reporters.
-- Hiding sets hidden_at and marks the target's open reports auto_hidden, pending
-- human review. Unhiding is an admin action (service key), in the admin milestone.
-- Dismissed and actioned reports no longer count toward the two.

create function private.auto_hide_on_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  hide boolean := new.is_safety;
begin
  if not hide then
    select count(distinct r.reporter_id) >= 2 into hide
    from public.reports r
    where r.status in ('open', 'auto_hidden')
      and not r.is_safety
      and r.target_kind = new.target_kind
      and r.target_person_id  is not distinct from new.target_person_id
      and r.target_crew_id    is not distinct from new.target_crew_id
      and r.target_message_id is not distinct from new.target_message_id;
  end if;

  if not hide then
    return null;
  end if;

  if new.target_person_id is not null then
    update public.people set hidden_at = coalesce(hidden_at, now()) where id = new.target_person_id;
    update public.reports set status = 'auto_hidden'
      where target_person_id = new.target_person_id and status = 'open';
  elsif new.target_crew_id is not null then
    update public.crews set hidden_at = coalesce(hidden_at, now()) where id = new.target_crew_id;
    update public.reports set status = 'auto_hidden'
      where target_crew_id = new.target_crew_id and status = 'open';
  elsif new.target_message_id is not null then
    update public.crew_messages set hidden_at = coalesce(hidden_at, now()) where id = new.target_message_id;
    update public.reports set status = 'auto_hidden'
      where target_message_id = new.target_message_id and status = 'open';
  end if;

  return null;
end;
$$;

revoke execute on function private.auto_hide_on_report() from public;

create trigger reports_auto_hide after insert on public.reports
  for each row execute function private.auto_hide_on_report();
