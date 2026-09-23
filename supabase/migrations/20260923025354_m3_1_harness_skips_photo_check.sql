-- Phase 3 M3.1 — the live photo check stops judging the policy harness's people.
--
-- **The bug** (found running test:policies, 22 Sept): P23 and P46 assert that another
-- person cannot get Eve's *pending* photo. The harness inserts Eve with a pending
-- 1-pixel PNG; this webhook fired, the Worker asked Claude, the permissive rubric
-- approved it within seconds, and the assertions then ran against a photo that was no
-- longer pending. The visibility rules were right; the harness's world was being
-- changed underneath it by a live pipeline — and every run spent money and wrote
-- `ai:photo-check` rows about people who do not exist.
--
-- **The marker is server-side only** (Alex's condition): `auth.users.raw_app_meta_data`,
-- which only the service key can write. A person's own session can change
-- `raw_user_meta_data` and nothing else, so nobody can mark themselves to skip the
-- check (P83 proves it). And the failure mode points the safe way: a skipped photo
-- stays `pending`, which is hidden (V6) — skipping can keep a photo unseen, never show
-- one.
--
-- Both paths that start a check skip it: this trigger, and the 09:00 sweep, which now
-- asks the database for what is waiting instead of selecting pending rows itself.

create function private.is_harness_user(p_auth_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (u.raw_app_meta_data ->> 'pind_harness') = 'true' from auth.users u where u.id = p_auth_user),
    false
  );
$$;

comment on function private.is_harness_user(uuid) is
  'True for a user the policy harness created and marked through the service key (app_metadata.pind_harness). Never settable from a session.';

revoke execute on function private.is_harness_user(uuid) from public, anon, authenticated;

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
  -- The harness's people are never sent to the check (see the header).
  if private.is_harness_user(new.auth_user_id) then
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

-- The sweep's question, asked where the marker can be read. Pending, with a photo,
-- oldest first — the person who has been invisible longest is the one waiting.
create function public.admin_photos_waiting(p_limit integer)
returns table (id uuid, photo_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.photo_path
  from public.people p
  where p.photo_status = 'pending'
    and p.photo_path is not null
    and not private.is_harness_user(p.auth_user_id)
  order by p.updated_at asc
  limit greatest(p_limit, 0);
$$;

comment on function public.admin_photos_waiting(integer) is
  'Photos the 09:00 sweep should check: pending, with a path, never the policy harness''s people.';

revoke execute on function public.admin_photos_waiting(integer) from public, anon, authenticated;
grant execute on function public.admin_photos_waiting(integer) to service_role;
