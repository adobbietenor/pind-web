-- Phase 3 M3.1 — "do the two halves of the shared secret match?", answerable.
--
-- **The gap this closes.** The photo-check webhook has a secret in two places: Vault,
-- which the trigger reads, and a Worker secret, which the route compares against.
-- Nobody — not Alex, not the Worker, not this database — could compare them, because
-- neither side will show its value and neither should. So a mismatch presented as a
-- **401 and nothing else**, which is indistinguishable from a missing credential, a
-- wrong URL or a Worker that is down. "Unset is a different state from broken" needs a
-- third sibling here: *set on both sides and different* is a state of its own.
--
-- A **fingerprint** answers it without either side revealing anything: the first ten
-- hex characters of the SHA-256 of the secret. Ten hex characters of a hash of a
-- high-entropy secret is not something anyone can work backwards from, and two of them
-- side by side answer the only question being asked. The admin's Configuration panel
-- prints the Worker's; this prints the database's.
--
-- It is deliberately NOT on a public surface. Like everything else here it is service
-- key only, and the admin sits behind Cloudflare Access.

-- A new column means a new row type, and `create or replace` cannot change one.
drop function if exists public.admin_photo_webhook_health();

create function public.admin_photo_webhook_health()
returns table (
  url_set              boolean,
  secret_set           boolean,
  secret_fingerprint   text,
  last_at              timestamptz,
  last_status          integer,
  last_error           text,
  waiting              bigint
)
language plpgsql stable security definer set search_path = '' as $fn$
declare
  reply record;
  raw text;
begin
  select s.decrypted_secret into raw from vault.decrypted_secrets s where s.name = 'photo_check_secret';
  select exists (select 1 from vault.decrypted_secrets s where s.name = 'photo_check_url') into url_set;
  secret_set := raw is not null and btrim(raw) <> '';
  -- The trigger sends the value as it is stored, so the fingerprint is of exactly
  -- that — untrimmed. A secret that differs only by a stray newline should show a
  -- different fingerprint, because that IS the difference.
  secret_fingerprint := case
    when raw is null then null
    else left(encode(extensions.digest(raw, 'sha256'), 'hex'), 10)
  end;

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
  'Whether the photo-check webhook is configured, what the last call answered, and a ten-character fingerprint of the database half of the shared secret — so the two halves can be compared without either being shown.';

revoke execute on function public.admin_photo_webhook_health() from public, anon, authenticated;
grant execute on function public.admin_photo_webhook_health() to service_role;
