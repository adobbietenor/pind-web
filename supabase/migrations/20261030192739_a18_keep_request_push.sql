-- UI pass 1, round 2 (Alex, 30 Oct 2026): "Keep-in-touch requests send a push, the same as
-- 1-on-1 requests (email when there's no device token)." Spec A18 #9.
--
-- The same shape as #8 (solo_proposal, 20261029140447):
--   * a switch of its own, on unless the person turned it off (notification_settings);
--   * one notification per request, queued when it is asked, to the person asked, unless
--     they are hidden, there is a block either way, or they switched it off;
--   * read again at every delivery attempt: a request taken back, answered, or from someone
--     since hidden or blocked is never sent;
--   * nobody is sent anything while they are a test person: admin_pending_notifications
--     hands a harness or seed person no token and no address (P162, unchanged);
--   * a request that turns two "Keep in touch" taps into a connection at once (ask_keep's
--     'connected') sends nothing: there is nothing left to answer.

-- The switch.
alter table public.notification_settings add column keep_request boolean not null default true;
grant update (keep_request) on public.notification_settings to authenticated;

create or replace function private.wants(p_person uuid, p_kind public.notification_kind) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_kind
      when 'digest' then s.digest when 'room_open' then s.room_open when 'plan_status' then s.plan_status
      when 'day_of' then s.day_of when 'next_morning' then s.next_morning when 'room_activity' then s.room_activity
      when 'invite' then s.invite when 'solo_proposal' then s.solo_proposal when 'keep_request' then s.keep_request end
    from public.notification_settings s where s.person_id = p_person
  ), true);
$$;

-- What the notification is about.
alter table public.notifications add column keep_request_id uuid references public.keep_requests (id) on delete set null;
comment on column public.notifications.keep_request_id is
  'For a #9 (keep_request): the request it is about (UI pass 1, round 2). Delivery sends it only while that request is open, its sender is not hidden and there is no block either way.';

-- Queued when the request is made, open. Connections is where it is answered (Requests).
create function private.notify_keep_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'open' then
    insert into public.notifications (person_id, kind, gathering_id, keep_request_id, title, body, path)
    select new.to_person, 'keep_request', new.gathering_id, new.id, private.gathering_name(new.gathering_id),
           -- PROPOSED copy (Tatiana's to reword).
           f.first_name || ' wants to keep in touch after ' || private.gathering_name(new.gathering_id),
           '/connections'
    from public.people f, public.people t
    where f.id = new.from_person and t.id = new.to_person
      and t.hidden_at is null
      and not private.blocked_between(new.from_person, new.to_person)
      and private.wants(new.to_person, 'keep_request');
  end if;
  return new;
end;
$$;
revoke all on function private.notify_keep_request() from public;
create trigger keep_requests_notify after insert on public.keep_requests
  for each row execute function private.notify_keep_request();

-- Once per pair per gathering (ask_keep inserts and never reopens: a take-back or a "Not now"
-- is not asked again), so one request is one notification at most.

-- Whether a #9 may still go out, read at every delivery attempt.
create function private.keep_request_still_deliverable(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.keep_requests r
    join public.people f on f.id = r.from_person
    where r.id = p_request
      and r.status = 'open'
      and f.hidden_at is null
      and not private.blocked_between(r.from_person, r.to_person)
  );
$$;
revoke all on function private.keep_request_still_deliverable(uuid) from public;

-- Delivery: as 20261029140447, with #9's check beside #8's.
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
    -- R5: a request that closed, a hidden sender or a block stops its push, at any attempt.
    and (n.kind <> 'solo_proposal' or (n.solo_proposal_id is not null and private.solo_request_still_deliverable(n.solo_proposal_id)))
    -- #9, the same: taken back, answered, a hidden sender or a block, and it is not sent.
    and (n.kind <> 'keep_request' or (n.keep_request_id is not null and private.keep_request_still_deliverable(n.keep_request_id)))
  order by n.created_at
  limit p_limit;
$$;
