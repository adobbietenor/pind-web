-- Phase 3 M3.1 — what the Worker actually said, not just the number it said it with.
--
-- The route now answers a refused webhook with *which* refusal it is: `missing` when
-- no header arrived (the trigger or pg_net) and `mismatch` when one arrived and was
-- wrong (the two halves of the secret). That sentence is in the reply body, and
-- pg_net has been storing it all along — this is the last piece of plumbing that
-- brings it back to the surface where somebody reads it.
--
-- Three times in this milestone the answer was one layer below the thing being
-- looked at: the status without the body, the secret's presence without its value's
-- shape, the Vault entry's presence without the URL. Each was a round trip. The reply
-- body is never a secret — it is our own JSON, written by our own route.

drop function if exists public.admin_photo_webhook_health();

create function public.admin_photo_webhook_health()
returns table (
  url                  text,
  secret_set           boolean,
  secret_fingerprint   text,
  last_at              timestamptz,
  last_status          integer,
  last_error           text,
  last_body            text,
  waiting              bigint
)
language plpgsql stable security definer set search_path = '' as $fn$
declare
  reply record;
  raw text;
begin
  select s.decrypted_secret into url from vault.decrypted_secrets s where s.name = 'photo_check_url';
  select s.decrypted_secret into raw from vault.decrypted_secrets s where s.name = 'photo_check_secret';
  secret_set := raw is not null and btrim(raw) <> '';
  secret_fingerprint := case when raw is null then null
    else left(encode(extensions.digest(raw, 'sha256'), 'hex'), 10) end;

  select r.created, r.status_code, r.error_msg, r.content into reply
  from net._http_response r order by r.created desc limit 1;
  last_at := reply.created;
  last_status := reply.status_code;
  last_error := reply.error_msg;
  last_body := left(coalesce(reply.content, ''), 300);

  select count(*) into waiting from net.http_request_queue;
  return next;
end;
$fn$;

comment on function public.admin_photo_webhook_health() is
  'Whether the photo-check webhook is configured and exactly what the last call came back with, body included. The URL and the reply are ours and are shown in full; the secret only as a ten-character fingerprint, so the two halves can be compared without either being revealed.';

revoke execute on function public.admin_photo_webhook_health() from public, anon, authenticated;
grant execute on function public.admin_photo_webhook_health() to service_role;
