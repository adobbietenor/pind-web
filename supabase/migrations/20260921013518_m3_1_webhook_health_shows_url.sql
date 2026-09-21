-- Phase 3 M3.1 — the webhook's target is not a secret, so the health check shows it.
--
-- Chasing the first 401 cost a round trip that a printed URL would have saved: "the
-- Vault entry is set" does not say **what** it is set to, and a webhook pointed at the
-- wrong path is answered in exactly the same shape as a wrong secret. The secret stays
-- a fingerprint, because it is a credential. The URL is our own public endpoint and
-- belongs on the screen in full.
--
-- The same distinction the rest of this milestone keeps: presence is not the same
-- question as correctness, and a status computed against the wrong fact reads as
-- correct while being wrong (M2.2's venue cap, M2.3's map keys).

drop function if exists public.admin_photo_webhook_health();

create function public.admin_photo_webhook_health()
returns table (
  url                  text,
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
  select s.decrypted_secret into url from vault.decrypted_secrets s where s.name = 'photo_check_url';
  select s.decrypted_secret into raw from vault.decrypted_secrets s where s.name = 'photo_check_secret';
  secret_set := raw is not null and btrim(raw) <> '';
  -- Of the value exactly as stored: the trigger sends it as it is, so a secret that
  -- differs only by a stray newline fingerprints differently, because that IS the
  -- difference.
  secret_fingerprint := case when raw is null then null
    else left(encode(extensions.digest(raw, 'sha256'), 'hex'), 10) end;

  select r.created, r.status_code, r.error_msg into reply
  from net._http_response r order by r.created desc limit 1;
  last_at := reply.created;
  last_status := reply.status_code;
  last_error := reply.error_msg;

  select count(*) into waiting from net.http_request_queue;
  return next;
end;
$fn$;

comment on function public.admin_photo_webhook_health() is
  'Whether the photo-check webhook is configured and what the last call answered. The URL is shown in full because it is ours and public; the secret only as a ten-character fingerprint, so the two halves can be compared without either being revealed.';

revoke execute on function public.admin_photo_webhook_health() from public, anon, authenticated;
grant execute on function public.admin_photo_webhook_health() to service_role;
