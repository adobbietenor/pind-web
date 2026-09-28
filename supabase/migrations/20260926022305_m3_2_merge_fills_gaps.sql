-- M3.2 — the merge fills the account's gaps, and leaves nothing of the anonymous person
-- behind (Alex, M3.2 walk, 26 Sept 2026).
--
-- Found on the walk: an anonymous pinner gave their date of birth, gender and photo at
-- A27, then entered an email that already had an account. The merge moved the pin and
-- the 19+ record and deleted the anonymous person — with everything just given — and
-- the photo file stayed in the bucket with nobody behind it. The account had no photo,
-- so the gate refused it at the very last step.
--
-- Alex's rules, all enforced here:
--   * **never overwrite what the account already has** — its photo, its date of birth
--     and gender, its first name (P128, P129);
--   * **fill only what is missing** — no photo: the anonymous person's comes in; no
--     people_private row: theirs comes in (P127, P129); an account with no profile
--     still takes the person whole (P115), and now its photo too (P130);
--   * **delete anything not moved, in the same step** — rows here, in this transaction;
--     the photo FILES by the Worker in the same request (`/account/merge`), which
--     copies the photo into the account's folder first, passes its new path here, and
--     then removes everything left in the anonymous folder;
--   * **service key only, after both sessions are verified** — unchanged (P116, P117).
--
-- **Why the file moves folders.** The bucket's owner policies key on the first folder
-- being the user's own id (photos_read_own / _update_own / _delete_own). A photo left
-- in the anonymous folder could never be seen, replaced or removed by its owner.
--
-- **A moved photo is checked again.** V6's trigger sends any change of photo_path back
-- to pending, so an approved photo can never be swapped for an unchecked one. The bytes
-- are the same, but that trigger is not reopened for a special case: the check runs
-- again in seconds. **A rejected photo is never carried** (P132) — it is not moved, and
-- the Worker deletes its file with the rest.
--
-- `p_photo_dest` must be a file in the ACCOUNT's own folder, or nothing is taken
-- (P131): the Worker cannot point the account at anyone else's file, even by mistake.

drop function public.admin_merge_anonymous(uuid, uuid);

-- What the Worker needs to know BEFORE the merge: which of the anonymous person's photo
-- files the account would take, so it can copy it into the account's folder first.
-- Null when nothing would be taken. Read-only.
create function public.admin_merge_photo_plan(p_anon uuid, p_perm uuid) returns text
language sql stable security definer set search_path = '' as $$
  select a.photo_path
  from public.people a
  where a.auth_user_id = p_anon
    and a.photo_path is not null
    and a.photo_status <> 'rejected'
    and not exists (
      select 1 from public.people b where b.auth_user_id = p_perm and b.photo_path is not null
    );
$$;

create function public.admin_merge_anonymous(p_anon uuid, p_perm uuid, p_photo_dest text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_anon_is boolean;
  v_perm_is boolean;
  v_a uuid;
  v_b uuid;
  v_a_photo text;
  v_a_status public.photo_status;
  v_take_photo boolean := false;
  v_took_details boolean := false;
  v_pin record;
  v_moved int := 0;
  v_merged int := 0;
begin
  if p_anon is null or p_perm is null or p_anon = p_perm then
    raise exception 'merge refused: two different users are needed' using errcode = '22023';
  end if;
  select is_anonymous into v_anon_is from auth.users where id = p_anon;
  select is_anonymous into v_perm_is from auth.users where id = p_perm;
  if v_anon_is is distinct from true then
    raise exception 'merge refused: the source is not an anonymous user' using errcode = '22023';
  end if;
  if v_perm_is is distinct from false then
    raise exception 'merge refused: the target is not a permanent user' using errcode = '22023';
  end if;
  -- The photo's new home must be the account's own folder, and nowhere else.
  if p_photo_dest is not null and (p_photo_dest not like p_perm::text || '/%' or p_photo_dest like '%/%/%' or p_photo_dest like '%..%') then
    raise exception 'merge refused: the photo must go to the account''s own folder' using errcode = '22023';
  end if;

  select id, photo_path, photo_status into v_a, v_a_photo, v_a_status from public.people where auth_user_id = p_anon;
  select id into v_b from public.people where auth_user_id = p_perm;

  -- The photo comes in only where the account has none, only if it was not rejected,
  -- and only once the Worker has put a copy in the account's folder.
  v_take_photo := v_a is not null
    and v_a_photo is not null
    and v_a_status <> 'rejected'
    and p_photo_dest is not null
    and not exists (select 1 from public.people where id = v_b and photo_path is not null);

  if v_a is not null and v_b is null then
    -- The account has no profile: the anonymous person becomes it, whole — with the
    -- photo in the account's folder, or none (the Worker deletes the old file).
    update public.people set auth_user_id = null where id = v_a;
    delete from auth.users where id = p_anon;
    update public.people
    set auth_user_id = p_perm,
        photo_path = case when v_take_photo then p_photo_dest else null end
    where id = v_a;
    return jsonb_build_object('rehomed', true, 'moved', 0, 'merged', 0, 'photo', v_take_photo, 'details', false);
  end if;

  if v_a is not null then
    for v_pin in select * from public.pins where person_id = v_a loop
      if exists (select 1 from public.pins where person_id = v_b and gathering_id = v_pin.gathering_id) then
        update public.pins set party_total = v_pin.party_total
        where person_id = v_b and gathering_id = v_pin.gathering_id;
        delete from public.pins where id = v_pin.id;
        v_merged := v_merged + 1;
      else
        update public.pins set person_id = v_b where id = v_pin.id;
        v_moved := v_moved + 1;
      end if;
    end loop;
    insert into public.age_attestations (person_id, attested_at, source)
    select v_b, attested_at, source from public.age_attestations where person_id = v_a
    on conflict (person_id) do nothing;

    -- Date of birth and gender: only into an account that has none. Never overwritten.
    if not exists (select 1 from public.people_private where person_id = v_b)
       and exists (select 1 from public.people_private where person_id = v_a) then
      update public.people_private set person_id = v_b where person_id = v_a;
      v_took_details := true;
    end if;

    -- The photo: only into an account that has none (checked again, as V6 requires).
    if v_take_photo then
      update public.people set photo_path = p_photo_dest where id = v_b and photo_path is null;
    end if;

    -- Everything not moved goes with the person: their private row, their photo path.
    delete from public.people where id = v_a;
  end if;
  delete from auth.users where id = p_anon;
  return jsonb_build_object('rehomed', false, 'moved', v_moved, 'merged', v_merged, 'photo', v_take_photo, 'details', v_took_details);
end;
$$;

revoke all on function public.admin_merge_photo_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_merge_photo_plan(uuid, uuid) to service_role;
revoke all on function public.admin_merge_anonymous(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_merge_anonymous(uuid, uuid, text) to service_role;
