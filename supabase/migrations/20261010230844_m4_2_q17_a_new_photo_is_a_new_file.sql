-- M4.2 — Q17: a new photo is always a new file (V6; Alex, 10 Oct 2026: "As it stands
-- anyone can bypass the AI check entirely").
--
-- What the review found: the owner could overwrite the bytes of an already-approved photo
-- in place (an upsert to their own photo_path), and it stayed 'approved' — the reset to
-- 'pending' fires only when people.photo_path changes, and the bytes behind an unchanged
-- path are not a change it can see. The same worked by deleting the approved file and
-- uploading new bytes under the same name. Either way: any image, shown as checked.
--
-- The fix — "a new photo always means a new file":
--   1. No overwrite in place: photos_update_own is dropped. The app never needed it — it
--      uploads with upsert off, to a new timestamped path every time
--      (packages/shared/src/image.ts).
--   2. No upload to a path that is anybody's current photo: an insert at a name some
--      people.photo_path points to is refused, so delete-and-reupload cannot slip new
--      bytes under an approved name.
-- A genuinely new photo is a new path; pointing photo_path at it resets the status to
-- 'pending' and the check runs (people_photo_change_resets_status), exactly as before.
-- The service key (the Worker's merge and the test crowd) is unaffected. Proved by P199;
-- Q17 in the review suite turns green.

drop policy photos_update_own on storage.objects;

create function private.photo_path_in_use(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.people p where p.photo_path = p_name);
$$;
revoke all on function private.photo_path_in_use(text) from public;
grant execute on function private.photo_path_in_use(text) to authenticated;

drop policy photos_insert_own on storage.objects;
create policy photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not private.photo_path_in_use(name)
  );
