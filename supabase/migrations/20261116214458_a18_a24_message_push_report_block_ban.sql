-- A18 #10, A24 and the admin's ban (Alex, 16 Nov 2026). Explained to Alex in plain English and
-- approved before it was written.
--
-- 1. #10, a new message (A18). In a 1-on-1 chat (the pair's connection chat — every
--    connection's) the other person; in a squad, every other member still in it. Never the
--    author; never anyone who looked at that chat in the last 2 minutes; never across a
--    block; never from or to a hidden person; never someone who switched it off. Batched:
--    at most one per chat per 5 minutes while you have not read it. Push, or email with no
--    device token, as the other nine; a harness or seed person is handed no device and no
--    address (admin_pending_notifications, P162). The words never carry the message:
--    "Bea sent you a message"; in a squad, "Bea in Section 314".
-- 2. A24. Your blocks, listed to you only (my_blocks), and unblock (unblock_person): it
--    restores seeing each other where both are still pinned and open, each other's room
--    messages, and asking again; it does NOT restore the connection or the chat (deleted by
--    the block), a squad you left, a called-off 1-on-1, or withdrawn requests.
-- 3. Every new report alerts the admin within a minute: a webhook to the Worker
--    (/hooks/report, the photo check's URL and secret from the vault), which emails
--    ADMIN_EMAILS. Never when the reporter or the reported is a harness or seed person
--    (report_alert_wanted, proved both ways in the harness).
-- 4. Ban (admin): hide, plus a sign-in lock the Worker sets on the account through Auth's
--    admin API; unban lifts both. Logged as the hide is (moderation_log 'ban' / 'unban').

-- ---------------------------------------------------------------------------
-- 1. #10
-- ---------------------------------------------------------------------------

alter table public.notification_settings add column chat_message boolean not null default true;
grant update (chat_message) on public.notification_settings to authenticated;

create or replace function private.wants(p_person uuid, p_kind public.notification_kind) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_kind
      when 'digest' then s.digest when 'room_open' then s.room_open when 'plan_status' then s.plan_status
      when 'day_of' then s.day_of when 'next_morning' then s.next_morning when 'room_activity' then s.room_activity
      when 'invite' then s.invite when 'solo_proposal' then s.solo_proposal when 'keep_request' then s.keep_request
      when 'chat_message' then s.chat_message end
    from public.notification_settings s where s.person_id = p_person
  ), true);
$$;

alter table public.notifications add column connection_id uuid references public.connections (id) on delete cascade;
comment on column public.notifications.connection_id is
  'For a #10 (chat_message) in a pair chat: the connection whose chat it is. Goes with the connection.';

-- One per chat per 5 minutes while unread: nothing queued for this person and chat in the
-- last 5 minutes, and nothing still waiting to go.
create function private.chat_ping_due(p_person uuid, p_crew uuid, p_connection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.notifications n
    where n.person_id = p_person and n.kind = 'chat_message'
      and ((p_crew is not null and n.crew_id = p_crew) or (p_connection is not null and n.connection_id = p_connection))
      and (n.sent_at is null or n.created_at > now() - interval '5 minutes')
  );
$$;
revoke all on function private.chat_ping_due(uuid, uuid, uuid) from public;

create function private.notify_squad_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_crew public.crews;
  v_author text;
begin
  if new.kind <> 'user' or new.author_id is null then return new; end if;
  select * into v_crew from public.crews where id = new.crew_id;
  -- Squads (and the old invite-only groups); a 1-on-1's chat is the pair chat, not this.
  if v_crew.id is null or v_crew.kind <> 'crew' or v_crew.state = 'dissolved' then return new; end if;
  select pe.first_name into v_author from public.people pe where pe.id = new.author_id and pe.hidden_at is null;
  if v_author is null then return new; end if;
  insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
  select m.person_id, 'chat_message', v_crew.gathering_id, v_crew.id,
         coalesce(v_crew.name, 'Your group'),
         -- PROPOSED copy (Tatiana's to reword). Never the message.
         v_author || ' in ' || coalesce(v_crew.name, 'your group'),
         '/group/' || v_crew.id
  from public.crew_members m join public.people p on p.id = m.person_id
  where m.crew_id = v_crew.id and m.left_at is null and m.person_id <> new.author_id
    and p.hidden_at is null
    and not private.blocked_between(m.person_id, new.author_id)
    and (m.last_seen_at is null or m.last_seen_at < now() - interval '2 minutes')
    and private.wants(m.person_id, 'chat_message')
    and private.chat_ping_due(m.person_id, v_crew.id, null);
  return new;
end;
$$;
revoke all on function private.notify_squad_message() from public;
create trigger crew_messages_notify after insert on public.crew_messages
  for each row execute function private.notify_squad_message();

create function private.notify_pair_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.connections;
  v_to uuid;
  v_seen timestamptz;
  v_author text;
begin
  select * into v_c from public.connections where id = new.connection_id;
  if v_c.id is null then return new; end if;
  v_to := case when v_c.person_a = new.author_id then v_c.person_b else v_c.person_a end;
  v_seen := case when v_c.person_a = v_to then v_c.a_seen_at else v_c.b_seen_at end;
  select pe.first_name into v_author from public.people pe where pe.id = new.author_id and pe.hidden_at is null;
  if v_author is null then return new; end if;
  insert into public.notifications (person_id, kind, connection_id, title, body, path)
  select v_to, 'chat_message', v_c.id, v_author,
         -- PROPOSED copy (Tatiana's to reword). Never the message.
         v_author || ' sent you a message',
         '/chat/' || v_c.id
  from public.people t
  where t.id = v_to and t.hidden_at is null
    and not private.blocked_between(v_to, new.author_id)
    and (v_seen is null or v_seen < now() - interval '2 minutes')
    and private.wants(v_to, 'chat_message')
    and private.chat_ping_due(v_to, null, v_c.id);
  return new;
end;
$$;
revoke all on function private.notify_pair_message() from public;
create trigger connection_messages_notify after insert on public.connection_messages
  for each row execute function private.notify_pair_message();

-- Read again at every delivery attempt: a message whose author has since been hidden or
-- blocked, or whose squad the person has left, is never sent.
create function private.chat_ping_still_deliverable(p_notification uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.notifications n
    where n.id = p_notification
      and (
        (n.connection_id is not null and exists (select 1 from public.connections c where c.id = n.connection_id
           and not private.blocked_between(c.person_a, c.person_b)))
        or (n.crew_id is not null and exists (select 1 from public.crew_members m where m.crew_id = n.crew_id
           and m.person_id = n.person_id and m.left_at is null))
      )
  );
$$;
revoke all on function private.chat_ping_still_deliverable(uuid) from public;

-- Delivery: as 20261030192739, with #10's check beside #8's and #9's.
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
    and (n.kind <> 'solo_proposal' or (n.solo_proposal_id is not null and private.solo_request_still_deliverable(n.solo_proposal_id)))
    and (n.kind <> 'keep_request' or (n.keep_request_id is not null and private.keep_request_still_deliverable(n.keep_request_id)))
    and (n.kind <> 'chat_message' or private.chat_ping_still_deliverable(n.id))
  order by n.created_at
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- 2. A24: my blocks, and unblock
-- ---------------------------------------------------------------------------

-- The people I blocked, to me only: a name and a face I already knew. Their photo through
-- the same can_see_photo rule as everywhere (a block hides it, so mostly none).
create function public.my_blocks() returns table (person_id uuid, first_name text, blocked_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select pe.id, pe.first_name, b.created_at
  from public.blocks b join public.people pe on pe.id = b.blocked_id
  where b.blocker_id = private.me()
  order by b.created_at desc;
$$;
revoke all on function public.my_blocks() from public, anon;
grant execute on function public.my_blocks() to authenticated;

create function public.unblock_person(p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  delete from public.blocks where blocker_id = v_me and blocked_id = p_person;
end;
$$;
revoke all on function public.unblock_person(uuid) from public, anon;
grant execute on function public.unblock_person(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The report alert
-- ---------------------------------------------------------------------------

-- Whether a report alerts the admin: never when the reporter, or the person reported, is a
-- harness or seed person. The trigger asks exactly this; the harness proves both sides.
create function private.report_alert_wanted(p_reporter uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.people pe
    where pe.id in (p_reporter, p_target)
      and (pe.is_seed or private.is_harness_user(pe.auth_user_id))
  );
$$;
revoke all on function private.report_alert_wanted(uuid, uuid) from public;

-- The service key's window on that rule, for the harness (service only).
create function public.admin_report_alert_wanted(p_reporter uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.report_alert_wanted(p_reporter, p_target);
$$;
revoke all on function public.admin_report_alert_wanted(uuid, uuid) from public, anon, authenticated;

create function private.report_alert_webhook() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  target text;
  secret text;
  v_person uuid := coalesce(
    new.target_person_id,
    (select m.author_id from public.crew_messages m where m.id = new.target_message_id),
    (select m.author_id from public.room_messages m where m.id = new.target_room_message_id)
  );
begin
  if not private.report_alert_wanted(new.reporter_id, v_person) then
    return null;
  end if;
  -- The photo check's own URL and secret (vault), trimmed at the point of use; the path is ours.
  select btrim(decrypted_secret) into target from vault.decrypted_secrets where name = 'photo_check_url';
  select btrim(decrypted_secret) into secret from vault.decrypted_secrets where name = 'photo_check_secret';
  if target is null or target = '' or secret is null or secret = '' then
    return null;
  end if;
  perform net.http_post(
    url := regexp_replace(target, '/hooks/photo-check$', '') || '/hooks/report',
    headers := jsonb_build_object('content-type', 'application/json', 'x-pind-webhook', secret),
    body := jsonb_build_object('report_id', new.id),
    timeout_milliseconds := 5000
  );
  return null;
end;
$fn$;
revoke all on function private.report_alert_webhook() from public;
create trigger reports_alert_admin after insert on public.reports
  for each row execute function private.report_alert_webhook();

-- What the alert says, read by the Worker with the service key.
create function public.admin_report_alert(p_report uuid) returns table (
  report_id uuid, reason public.report_reason, target_kind public.report_target, person_id uuid, first_name text,
  crew_name text, hidden boolean, reports_on_them bigint, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.reason, r.target_kind, pe.id, pe.first_name, c.name, pe.hidden_at is not null,
         (select count(*) from public.reports x where x.target_person_id = pe.id), r.created_at
  from public.reports r
  left join public.people pe on pe.id = r.target_person_id
  left join public.crews c on c.id = r.target_crew_id
  where r.id = p_report;
$$;
revoke all on function public.admin_report_alert(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Ban
-- ---------------------------------------------------------------------------

-- The database half: hidden (as admin_hide_person, reports actioned) and logged. The Worker
-- sets the account's sign-in lock right after, through Auth's admin API, with the returned id.
create function public.admin_ban_person(p_person uuid, p_actor text, p_note text default null) returns uuid
language plpgsql set search_path = '' as $$
declare v_auth uuid;
begin
  select auth_user_id into v_auth from public.people where id = p_person;
  if not found then raise exception 'That person does not exist'; end if;
  update public.people set hidden_at = coalesce(hidden_at, now()) where id = p_person;
  update public.reports set status = 'actioned', reviewed_at = now(), decision_note = p_note
  where target_person_id = p_person and status in ('open', 'auto_hidden');
  insert into public.moderation_log (actor, action, person_id, note) values (p_actor, 'ban', p_person, p_note);
  return v_auth;
end;
$$;
revoke all on function public.admin_ban_person(uuid, text, text) from public, anon, authenticated;

create function public.admin_unban_person(p_person uuid, p_actor text, p_note text default null) returns uuid
language plpgsql set search_path = '' as $$
declare v_auth uuid;
begin
  select auth_user_id into v_auth from public.people where id = p_person;
  if not found then raise exception 'That person does not exist'; end if;
  update public.people set hidden_at = null where id = p_person;
  insert into public.moderation_log (actor, action, person_id, note) values (p_actor, 'unban', p_person, p_note);
  return v_auth;
end;
$$;
revoke all on function public.admin_unban_person(uuid, text, text) from public, anon, authenticated;
