-- M3.3c — a seed person is never sent anything (6 Oct 2026; CLAUDE.md: "any job that sends
-- something to a person checks it is not a test person — and a test makes that check
-- fire").
--
-- Delivery skipped harness people only. The test crowd's people are seed people with
-- real-looking accounts (test-crowd-…@example.com, not marked as harness), so a message a
-- tester posted in the test crowd's room queued #6 for them — and delivery would email
-- it to an address that bounces, on the sending domain whose reputation decides whether
-- real sign-in codes arrive. Found while setting up stand-ins for Alex's phone walk.
--
-- The check lives in the query that picks who to send to, as the rule says: a seed person
-- gets no phone and no address, the same as a harness person. Proved by P186.

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
  order by n.created_at
  limit p_limit;
$$;
