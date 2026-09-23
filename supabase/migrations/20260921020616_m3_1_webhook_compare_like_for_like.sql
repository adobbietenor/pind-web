-- Phase 3 M3.1 — the two fingerprints were not measuring the same thing.
--
-- **The bug, and it is the worst kind.** The Worker fingerprints
-- `PHOTO_WEBHOOK_SECRET.trim()`; this function fingerprinted the Vault value **as
-- stored**, untrimmed. So a value with a stray newline round it produced two different
-- fingerprints for what is, after trimming, the same secret — and the panel built to
-- answer "are these the same?" reported a difference that was **in the measurement,
-- not in the thing measured**. Alex set both halves to one fresh value, twice, and the
-- panel said they differed both times. It was right that something was wrong and wrong
-- about what.
--
-- That is the M2.2 venue-cap shape once more, in the tool built to catch it: *a status
-- computed against the wrong fact reads as correct while being wrong.* A comparison is
-- only a comparison if both sides are measured the same way.
--
-- **Two changes, and the second is the actual fault:**
--
--   1. The fingerprint is of the **trimmed** value on both sides, so the two numbers
--      are comparable. Whitespace gets its own answer instead — `secret_padded` — so
--      it is still visible rather than quietly normalised away.
--   2. **The trigger now sends the trimmed value.** Sending an untrimmed secret as an
--      HTTP header was wrong on its own terms: a header value cannot contain a
--      newline, so a padded secret was being mangled or dropped in transit, which is
--      why the route answered `mismatch` even when both halves held the same secret.
--      The Worker already trims what it receives and what it compares against; the
--      only place still sending raw bytes was this trigger.

create or replace function private.photo_check_webhook() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  target text;
  secret text;
begin
  if new.photo_path is null or new.photo_status <> 'pending' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.photo_path is not distinct from new.photo_path
     and old.photo_status is not distinct from new.photo_status then
    return new;
  end if;

  -- Trimmed at the point of use. A secret pasted with a trailing newline is a
  -- credential that is right and a header that is broken, and the difference was
  -- invisible from both ends.
  select btrim(decrypted_secret) into target from vault.decrypted_secrets where name = 'photo_check_url';
  select btrim(decrypted_secret) into secret from vault.decrypted_secrets where name = 'photo_check_secret';
  if target is null or target = '' or secret is null or secret = '' then
    return new;
  end if;

  perform net.http_post(
    url := target,
    headers := jsonb_build_object('content-type', 'application/json', 'x-pind-webhook', secret),
    body := jsonb_build_object(
      'type', tg_op,
      'table', 'people',
      'record', jsonb_build_object('id', new.id, 'photo_path', new.photo_path),
      'old_record', case
        when tg_op = 'UPDATE' then jsonb_build_object('photo_path', old.photo_path)
        else null
      end
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$fn$;

drop function if exists public.admin_photo_webhook_health();

create function public.admin_photo_webhook_health()
returns table (
  url                  text,
  secret_set           boolean,
  secret_fingerprint   text,
  secret_padded        boolean,
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
  select btrim(s.decrypted_secret) into url from vault.decrypted_secrets s where s.name = 'photo_check_url';
  select s.decrypted_secret into raw from vault.decrypted_secrets s where s.name = 'photo_check_secret';
  secret_set := raw is not null and btrim(raw) <> '';
  -- Of the TRIMMED value, because that is what the Worker fingerprints and what the
  -- trigger now sends. Two numbers that are not measured the same way are not a
  -- comparison.
  secret_fingerprint := case when raw is null then null
    else left(encode(extensions.digest(btrim(raw), 'sha256'), 'hex'), 10) end;
  -- Whitespace is not normalised away silently: it gets its own answer, because a
  -- secret stored with a newline round it is a real thing to know about.
  secret_padded := raw is not null and raw <> btrim(raw);

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
  'Whether the photo-check webhook is configured and exactly what the last call came back with. Both fingerprints are of the TRIMMED value, so the two halves are measured the same way; surrounding whitespace is reported separately rather than hidden.';

revoke execute on function public.admin_photo_webhook_health() from public, anon, authenticated;
grant execute on function public.admin_photo_webhook_health() to service_role;
