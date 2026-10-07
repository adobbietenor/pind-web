-- M3.3 — the harness's people are never emailed or pushed.
--
-- The policy harness makes people with @example.com addresses and proves #2 and #6 are
-- written (P159–P162). With delivery running every minute, those rows would be emailed —
-- to a domain that bounces, on every run, costing pind.social's sending reputation. The
-- same marker the photo check honours (`private.is_harness_user`, set only by the
-- service key in app_metadata) sends them nowhere: the row is still written, and still
-- proves the rule; its delivery is "none".

create or replace function public.admin_pending_notifications(p_limit integer default 100)
returns table (id uuid, person_id uuid, kind public.notification_kind, title text, body text, path text, attempts smallint,
               tokens text[], email text)
language sql stable security definer set search_path = '' as $$
  select n.id, n.person_id, n.kind, n.title, n.body, n.path, n.attempts,
    case when private.is_harness_user(p.auth_user_id) then '{}'::text[]
         else array(select d.token from public.device_tokens d where d.person_id = n.person_id order by d.last_seen_at desc) end,
    case when private.is_harness_user(p.auth_user_id) then null
         else (select u.email::text from auth.users u where u.id = p.auth_user_id and not coalesce(u.is_anonymous, false)) end
  from public.notifications n
  join public.people p on p.id = n.person_id
  where n.sent_at is null and n.attempts < 3
  order by n.created_at
  limit p_limit;
$$;
