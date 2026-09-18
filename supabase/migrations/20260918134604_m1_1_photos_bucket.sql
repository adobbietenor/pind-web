-- Phase 1 M1.1 — the private photo bucket (docs/visibility.md V6).
--
-- No public URL exists. A photo is read only through a signed URL, and Storage issues
-- one only when the requester passes the SELECT policies below. Each visitor's files
-- live in a folder named after their auth user id: "<auth uid>/<file>".
-- people.photo_path holds the object name within this bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Own folder: upload, read, replace, delete.
create policy photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy photos_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Someone else's photo: approved, and its owner visible to me (V1).
create policy photos_read_visible on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and private.can_see_photo(name));
