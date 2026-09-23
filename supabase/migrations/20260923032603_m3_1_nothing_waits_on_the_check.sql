-- Phase 3 M3.1 — nothing waits on the photo check (Alex, 23 Sept).
--
-- **Before:** a photo was visible to others only once it was `approved`. A new or
-- replaced photo was `pending`, and hidden, until the check answered; `needs_review`
-- was hidden until Alex looked; a check that failed left the photo pending and
-- hidden until the sweep or Alex. So every failure of the pipeline — a broken
-- webhook, an unset key, a model that errored — meant **"invisible, and nobody
-- knows"**.
--
-- **After:** a photo is visible to exactly the people who can see its owner (V1,
-- unchanged) **unless it is `rejected`**. The check runs afterwards and can only
-- remove. `needs_review` (a possible minor) stays visible and sits in Alex's queue;
-- `pending` means "not checked yet" and `failed` checks are counted in the admin —
-- **"unchecked, and counted"**. Nobody is stuck invisible because a pipeline broke.
-- The pattern is Meetup's and Discord's: post, then moderate by scanning and reports.
--
-- What it still denies is everything it denied: a rejected photo is seen by its
-- owner alone (the person stays visible without it), and nobody who cannot see the
-- person — anon, somebody who pinned without opting in, a blocked or hidden person —
-- gets anything. The exposure this accepts is a photo that will be rejected being
-- visible to those few people for the ~3 s the check takes, or until the hourly
-- sweep if the webhook is broken.
--
-- Harness: P23, P46, P71 and P73 inverted or reworked in the same commit; P87 proves
-- the check removes.

create or replace function private.can_see_photo(p_object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.people pe
    where pe.photo_path = p_object_name
      and pe.photo_status <> 'rejected'
      and pe.auth_user_id is not null
      and split_part(p_object_name, '/', 1) = pe.auth_user_id::text
      and private.can_see(pe.id)
  );
$$;

comment on function private.can_see_photo(text) is
  'V6 (M3.1, "nothing waits on the check"): a photo is visible to whoever can see its owner (V1), unless it is rejected. Pending, needs_review and failed-check photos are visible; the check can only remove.';
