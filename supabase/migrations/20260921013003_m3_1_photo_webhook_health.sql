-- Phase 3 M3.1 — can the photo-check webhook actually reach the Worker?
--
-- **Why this exists.** The first end-to-end test did nothing at all, and the three
-- reasons it could do nothing were indistinguishable from outside: the Vault entries
-- might be missing, so the trigger returns quietly; pg_net might have queued a request
-- that never got a reply; or the Worker might have answered 401 because the two halves
-- of the shared secret do not match. All three look like "the photo is still pending",
-- which is the state the admin already counts as *never checked* — true, and useless
-- for working out why.
--
-- So this function answers the question one layer down, the way `admin_photo_states`
-- answers the one above it. It reports **whether** each credential is present and
-- never what it is: presence, emptiness and absence are the three states, and the
-- value is never returned, logged or rendered (the rule `src/ops/secrets.ts` follows
-- for the Worker's own settings).
--
-- `net._http_response` is pg_net's own reply table. It is pruned after a few hours, so
-- a null here means "nothing recent", not "nothing ever". The photo check is the only
-- thing in this database using pg_net, so the last row is ours.

create function public.admin_photo_webhook_health()
returns table (
  url_set      boolean,
  secret_set   boolean,
  last_at      timestamptz,
  last_status  integer,
  last_error   text,
  waiting      bigint
)
language plpgsql stable security definer set search_path = '' as $fn$
declare
  reply record;
begin
  url_set := exists (select 1 from vault.decrypted_secrets s where s.name = 'photo_check_url');
  secret_set := exists (select 1 from vault.decrypted_secrets s where s.name = 'photo_check_secret');

  select r.created, r.status_code, r.error_msg into reply
  from net._http_response r
  order by r.created desc
  limit 1;

  last_at := reply.created;
  last_status := reply.status_code;
  last_error := reply.error_msg;

  select count(*) into waiting from net.http_request_queue;
  return next;
end;
$fn$;

comment on function public.admin_photo_webhook_health() is
  'Whether the photo-check webhook is configured and what the last call came back with. Says whether each credential is present, never what it is.';

revoke execute on function public.admin_photo_webhook_health() from public, anon, authenticated;
grant execute on function public.admin_photo_webhook_health() to service_role;
