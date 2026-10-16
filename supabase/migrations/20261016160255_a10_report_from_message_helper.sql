-- A10 — fix: 20261016153531's policy refused EVERY report, not only reports from a message.
--
-- reports_insert_from_a_message called private.is_hidden and private.blocked_between
-- directly. A policy runs as the person filing the report, who may not execute either
-- function, and Postgres evaluates every permissive insert policy on the table — so each
-- insert into `reports`, a plain person report or a squad report included, failed with
-- "permission denied for function blocked_between". The policy harness caught it on its
-- first run (P34, P35, P236 and 18 more, all the same error).
--
-- The fix is the room's own pattern (private.room_peer): the two checks move into one
-- security-definer function granted to signed-in people, and the policy calls that. It
-- answers only about the caller: am I hidden, and is there a block between me and them.
-- `private` is not an exposed API schema, so nobody can call it except inside a policy.
-- The policy's rule is otherwise exactly 20261016153531's.

create function private.may_report_from_a_message(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p_target <> me.id
       and not private.is_hidden(me.id)
       and not private.blocked_between(me.id, p_target)
    from (select private.me() as id) me
    where me.id is not null
  ), false);
$$;
revoke all on function private.may_report_from_a_message(uuid) from public;
grant execute on function private.may_report_from_a_message(uuid) to authenticated;
comment on function private.may_report_from_a_message(uuid) is
  'A10 (16 Oct 2026): the caller may report this person from a message — not themselves, not while hidden (Q39), not across a block. The message itself is checked by the policy, under the message tables'' read rules.';

drop policy reports_insert_from_a_message on public.reports;
create policy reports_insert_from_a_message on public.reports
  for insert to authenticated
  with check (
    reporter_id = private.me()
    and target_kind = 'person'
    and target_person_id is not null
    and private.may_report_from_a_message(target_person_id)
    and context_at is not null
    and (
      (
        context_room_id is not null and context_crew_id is null
        and exists (
          select 1 from public.room_messages m
          where m.room_id = context_room_id and m.author_id = target_person_id and m.created_at = context_at
        )
      )
      or (
        context_crew_id is not null and context_room_id is null
        and exists (
          select 1 from public.crew_messages m
          where m.crew_id = context_crew_id and m.author_id = target_person_id and m.created_at = context_at and m.kind = 'user'
        )
      )
    )
  );
