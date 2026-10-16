-- A10, A11, A29 — reports are on people, never on messages (Alex, 16 Oct 2026).
--
-- "We report people, not messages. Keep the chat clean." Long-pressing a message now
-- offers "Report <name>": a report on the PERSON who wrote it, carrying where it came
-- from (the room or the thread) and when (the message's time) so the admin can go and
-- look — and never the message's words. H9 still holds: report is two taps from any
-- message, and from a message it reports its author (decisions, "Reports are on people").
--
-- 1. Who may report someone from a message (new policy, reports_insert_from_a_message):
--    exactly who could report the message before — anyone who can READ that message,
--    decided by the message tables' own read rules (the subqueries below run as the
--    reporter, under room_messages_read / crew_messages_read_members). That is wider than
--    the people list (can_see): the room stays readable for 24 hours after the list
--    closes (room_peer, Q11), and the old message policy covered those days, so this one
--    must too. Never yourself, never across a block, and never while you are hidden
--    (Q39: a hidden person still in a squad can read its thread, and must not be able to
--    hide another member by reporting them).
--    The context must name a real message by that person, in that room or thread, at
--    that time — so it cannot be forged to point anywhere else.
-- 2. The plain person report (reports_insert_on_visible_person) is unchanged, except that
--    it may not carry a context: a context is only ever one the policy above has checked.
-- 3. Gone, with the path that fed them:
--    - the room-message report policy and its column grant;
--    - reports_hide_room_message (a safety report hid the message at once) — a safety
--      report now hides the PERSON at once, through auto_hide_on_report's person branch;
--    - auto_hide_on_report's group-message branch (nothing could file one from the app);
--    - report_takes_out_of_solo's two message lookups — a report from a message is
--      already a report on its author, so the rule still fires, through target_person_id;
--    - crew_messages_solo_follows_hide (a hidden thread message called the plan off) —
--      nothing hides a thread message any more. A plan is still called off when the
--      person in it is HIDDEN (people_solo_follows_hide), which a safety reason from its
--      thread does at once, or when the plan itself is hidden (crews_solo_follows_hide).
--      Any report also takes them out of 1-on-1 (hidden_from_solo), which closes pending
--      proposals but, as before, leaves a plan already made standing;
--    - snapshot_reported_message: a report keeps no message text.
-- 4. The history stays readable: the message columns (target_message_id,
--    target_room_message_id, reported_content_snapshot) and the 'message' kind are kept,
--    read-only, and dropped in a later migration once nothing reads them. The open
--    message reports — never shown by the admin, which lists person reports only — are
--    closed as dismissed, each logged.
-- Proved by P239–P250, and R33–R36 in the review suite.

-- ---------------------------------------------------------------------------
-- Where a report came from
-- ---------------------------------------------------------------------------

alter table public.reports add column context_room_id uuid references public.rooms (id) on delete set null;
alter table public.reports add column context_crew_id uuid references public.crews (id) on delete set null;
-- The reported message's own time: where to look, not what was said.
alter table public.reports add column context_at timestamptz;
alter table public.reports add constraint reports_context_is_a_place_and_a_time check (
  (context_room_id is null and context_crew_id is null and context_at is null)
  or (target_kind = 'person' and context_at is not null and num_nonnulls(context_room_id, context_crew_id) = 1)
  -- A room deleted later sets its id null (on delete set null): the time stays, as history.
  or (target_kind = 'person' and context_at is not null and context_room_id is null and context_crew_id is null)
);
create index reports_context_room_id_idx on public.reports (context_room_id);
create index reports_context_crew_id_idx on public.reports (context_crew_id);
comment on column public.reports.context_at is
  'A report filed from a message: the message''s created_at. Never its text (Alex, 16 Oct 2026).';

grant insert (context_room_id, context_crew_id, context_at) on public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- 1 and 2: the two ways to report a person
-- ---------------------------------------------------------------------------

drop policy reports_insert_on_visible_person on public.reports;
create policy reports_insert_on_visible_person on public.reports
  for insert to authenticated
  with check (
    reporter_id = private.me()
    and target_kind = 'person'
    and target_person_id is not null
    and private.can_see(target_person_id)
    and context_room_id is null and context_crew_id is null and context_at is null
  );

create policy reports_insert_from_a_message on public.reports
  for insert to authenticated
  with check (
    reporter_id = private.me()
    and target_kind = 'person'
    and target_person_id is not null
    and target_person_id <> private.me()
    and not private.is_hidden(private.me())
    and not private.blocked_between(private.me(), target_person_id)
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

-- ---------------------------------------------------------------------------
-- 3: the message path, and every rule that keyed off it
-- ---------------------------------------------------------------------------

drop policy reports_insert_on_readable_room_message on public.reports;
revoke insert (target_room_message_id) on public.reports from authenticated;

drop trigger reports_hide_room_message on public.reports;
drop function private.reports_hide_room_message();

drop trigger crew_messages_solo_follows_hide on public.crew_messages;
drop function private.crew_messages_solo_follows_hide();

drop trigger reports_snapshot_reported_message on public.reports;
drop function public.snapshot_reported_message();

-- H9's auto-hide: people and squads only. The body is otherwise 20260918134606's.
create or replace function private.auto_hide_on_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  hide boolean := new.is_safety;
begin
  if new.target_person_id is null and new.target_crew_id is null then
    return null;
  end if;

  if not hide then
    select count(distinct r.reporter_id) >= 2 into hide
    from public.reports r
    where r.status in ('open', 'auto_hidden')
      and not r.is_safety
      and r.target_kind = new.target_kind
      and r.target_person_id is not distinct from new.target_person_id
      and r.target_crew_id   is not distinct from new.target_crew_id;
  end if;

  if not hide then
    return null;
  end if;

  if new.target_person_id is not null then
    update public.people set hidden_at = coalesce(hidden_at, now()) where id = new.target_person_id;
    update public.reports set status = 'auto_hidden'
      where target_person_id = new.target_person_id and status = 'open';
  else
    update public.crews set hidden_at = coalesce(hidden_at, now()) where id = new.target_crew_id;
    update public.reports set status = 'auto_hidden'
      where target_crew_id = new.target_crew_id and status = 'open';
  end if;

  return null;
end;
$$;

-- Any report on a person — including one filed from their message — or on a 1-on-1 plan
-- takes them out of 1-on-1. The message lookups are gone: a report from a message names
-- its author in target_person_id. The body is otherwise 20261014215515's.
create or replace function private.report_takes_out_of_solo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_person uuid := coalesce(
    new.target_person_id,
    (select m.person_id from public.crew_members m join public.crews c on c.id = m.crew_id
     where m.crew_id = new.target_crew_id and c.kind = 'solo' and m.person_id is distinct from new.reporter_id
     limit 1)
  );
begin
  if v_person is not null then
    update public.people set hidden_from_solo = true where id = v_person and not hidden_from_solo;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4: close the open message reports, each logged
-- ---------------------------------------------------------------------------

with closed as (
  update public.reports r
  set status = 'dismissed',
      reviewed_at = now(),
      decision_note = 'Closed when message reports were retired (16 Oct 2026): reports are on people, not messages. Not reviewed individually.'
  where r.target_kind = 'message' and r.status in ('open', 'auto_hidden')
  returning r.id, r.target_room_message_id, r.target_message_id
)
insert into public.moderation_log (actor, action, person_id, note)
select
  'migration:a10_reports_on_people_not_messages',
  'dismiss_message_report',
  coalesce(
    (select m.author_id from public.room_messages m where m.id = closed.target_room_message_id),
    (select m.author_id from public.crew_messages m where m.id = closed.target_message_id)
  ),
  'report ' || closed.id || ' closed: message reports retired'
from closed;
