-- M3.3b — people with no account: one rule, used by the photo sweep and by the clean-up
-- (Alex, 6 Oct 2026).
--
-- The account link is "on delete set null", so a person row whose account was deleted
-- without it stays behind, unmarked — the harness's marker lives on the account. The
-- policy harness did exactly that in 19 places, and 979 such rows piled up on staging;
-- the photo sweep could not tell they were test people and failed on their missing
-- photos every hour. Nothing real is ever a person without an account: every pin starts
-- with an anonymous account, account deletion (A23) deletes the person first, the merge
-- re-homes the person before the anonymous account goes, and the test crowd's refresh
-- deletes its people with their accounts.
--
-- So: ONE definition, `private.is_accountless_person`, which the sweep's queue skips by and
-- this clean-up deletes by — Alex: "so the two can't disagree". The harness now deletes
-- its people with their accounts (`removeUser`) and P184 fails any run that leaves one.

create function private.is_accountless_person(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.people p where p.id = p_person and p.auth_user_id is null);
$$;
revoke all on function private.is_accountless_person(uuid) from public;

create or replace function public.admin_photos_waiting(p_limit integer)
returns table (id uuid, photo_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.photo_path
  from public.people p
  where p.photo_status = 'pending'
    and p.photo_path is not null
    and not private.is_harness_user(p.auth_user_id)
    and not private.is_accountless_person(p.id)
  order by p.updated_at asc
  limit greatest(p_limit, 0);
$$;

-- The leftovers, by the same rule.
delete from public.people p where private.is_accountless_person(p.id);
