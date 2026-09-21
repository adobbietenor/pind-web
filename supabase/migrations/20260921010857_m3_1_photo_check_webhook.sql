-- Phase 3 M3.1 — the database webhook that starts a photo check.
--
-- **A visitor is never the thing that does the work** (CLAUDE.md). The app's call to
-- the Worker after an upload is the net; THIS is the mechanism. M2.1 built the venue
-- maps the other way round — the safety net was the only thing that ever ran — and by
-- M2.3, 29 of 37 venues had no picture and the first person through the door saw a
-- drawing. A photo has the same shape: if only the app's own call ever fires, a photo
-- uploaded on a flaky connection is never looked at, and nothing says so.
--
-- **Written as a migration rather than clicked into the dashboard**, like every other
-- rule here: config I cannot reproduce from this repo is a broken repo (CLAUDE.md).
-- Supabase's own "Database Webhooks" feature would build the same trigger by hand and
-- put the secret header inside the trigger definition, where `pg_dump` and anyone with
-- catalog access can read it.
--
-- **The two values are credentials and are not in this repo.** They live in Supabase
-- Vault, and Alex sets them once, on staging, with:
--
--     select vault.create_secret('https://pind.social/hooks/photo-check', 'photo_check_url');
--     select vault.create_secret('<the same value as the PHOTO_WEBHOOK_SECRET worker secret>', 'photo_check_secret');
--
-- Until both exist the trigger does nothing at all — quietly, because a missing
-- credential is a configuration problem and the admin's photo queue is where it
-- reports itself ("never checked", counted, next to "PHOTO_WEBHOOK_SECRET is not
-- set"). A trigger that raised here would block the upload instead.

create extension if not exists pg_net;

create function private.photo_check_webhook() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  target text;
  secret text;
begin
  -- Only a pending photo is worth a call: an approved or rejected one has been
  -- decided, and a row with no photo has nothing to check.
  if new.photo_path is null or new.photo_status <> 'pending' then
    return new;
  end if;
  -- On an update, only when something about the photo actually moved. An edit to a
  -- first name must not spend money.
  if tg_op = 'UPDATE'
     and old.photo_path is not distinct from new.photo_path
     and old.photo_status is not distinct from new.photo_status then
    return new;
  end if;

  select decrypted_secret into target from vault.decrypted_secrets where name = 'photo_check_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'photo_check_secret';
  if target is null or secret is null then
    return new;
  end if;

  -- pg_net is asynchronous: this queues the request and returns at once, so an upload
  -- never waits on the Worker, and a Worker that is down cannot fail a write.
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

comment on function private.photo_check_webhook() is
  'Starts the automated photo check. Asynchronous (pg_net), so an upload never waits on the Worker and a Worker that is down cannot fail a write. Silent when its Vault entries are absent: the admin photo queue is where that reports itself.';

create trigger people_photo_check_webhook
after insert or update of photo_path, photo_status on public.people
for each row execute function private.photo_check_webhook();
