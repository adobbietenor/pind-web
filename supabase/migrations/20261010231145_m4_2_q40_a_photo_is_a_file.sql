-- M4.2 — Q40: the opt-in gate's photo is a real file (Q2, §3 may_meet; Alex, 10 Oct 2026).
--
-- What the review found: private.may_meet asks only that people.photo_path is set. A
-- person with no photo pointed their own photo_path at a file that does not exist, then
-- opted in to meeting — on the list, counted as open to meeting, with no face.
--
-- The fix is at the act, not the gate: **a photo path a person sets must be a file that
-- exists, and the file behind someone's current photo cannot be deleted while it is
-- theirs.** Then "photo_path is set" always means a real file, so may_meet, its app copy
-- (optInMissing) and P126's comparison of the two stay exactly as they are.
--
--   * A person's own insert or update of photo_path (the request's role is
--     'authenticated') must name an object in the photos bucket. The service key (the
--     Worker's merge, the test crowd, harness setup) is not a person acting and is not
--     checked here. The folder rule is unchanged and still refuses on its own (RLS).
--   * photos_delete_own no longer deletes a path that is somebody's current photo. The
--     app removes an old photo only after pointing photo_path at the new one, so it is
--     unaffected; deleting an account goes through the service key.
--
-- Proved by P200; Q40 in the review suite turns green.

create function private.people_photo_is_a_file() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.photo_path is not null
     and (tg_op = 'INSERT' or new.photo_path is distinct from old.photo_path)
     and coalesce(auth.role(), '') = 'authenticated'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = new.photo_path)
  then
    raise exception 'That photo has not been uploaded.'
      using errcode = 'check_violation', hint = 'q40_photo_not_a_file';
  end if;
  return new;
end;
$$;
revoke all on function private.people_photo_is_a_file() from public;

create trigger people_photo_is_a_file
  before insert or update of photo_path on public.people
  for each row execute function private.people_photo_is_a_file();

drop policy photos_delete_own on storage.objects;
create policy photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not private.photo_path_in_use(name)
  );
