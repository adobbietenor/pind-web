-- M3.2 — the merge also carries the neighbourhood and the tags into an account that has
-- none (Alex, M3.2 walk, 26 Sept 2026).
--
-- A27 now draws the same steps as the store path (one set of profile steps), so the
-- link path asks for a neighbourhood and tags BEFORE a way to sign in. When the sign-in
-- turns out to be an existing account, those answers belong to the anonymous person the
-- merge deletes. Alex's rules for the merge apply unchanged:
--
--   * **never overwrite what the account already has** — its neighbourhood, and its
--     tags as a set: an account with any tags keeps exactly its own (P134);
--   * **fill only what is missing** — no neighbourhood: the anonymous one comes in; no
--     tags: the anonymous set comes in, rows re-homed rather than copied (P133);
--   * **delete anything not moved, in the same step** — the anonymous person's rows go
--     with the person, as before.
--
-- Tags move as a SET, never merged: a person's tags are their answer (three to ten, the
-- ones on the list chosen), and half of one answer mixed into another is neither.
--
-- Everything else is exactly m3_2_merge_fills_gaps: the photo and the date of birth and
-- gender, the pins and the 19+ record, the checks, the service key only.

create or replace function public.admin_merge_anonymous(p_anon uuid, p_perm uuid, p_photo_dest text default null) returns jsonb
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
  v_took_hood boolean := false;
  v_took_tags boolean := false;
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

  v_take_photo := v_a is not null
    and v_a_photo is not null
    and v_a_status <> 'rejected'
    and p_photo_dest is not null
    and not exists (select 1 from public.people where id = v_b and photo_path is not null);

  if v_a is not null and v_b is null then
    -- The account has no profile: the anonymous person becomes it, whole — tags and
    -- neighbourhood included — with the photo in the account's folder, or none.
    update public.people set auth_user_id = null where id = v_a;
    delete from auth.users where id = p_anon;
    update public.people
    set auth_user_id = p_perm,
        photo_path = case when v_take_photo then p_photo_dest else null end
    where id = v_a;
    return jsonb_build_object('rehomed', true, 'moved', 0, 'merged', 0, 'photo', v_take_photo, 'details', false, 'neighbourhood', false, 'tags', false);
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

    -- The neighbourhood: only into an account that has none.
    update public.people b
    set neighbourhood = a.neighbourhood
    from public.people a
    where b.id = v_b and a.id = v_a and b.neighbourhood is null and a.neighbourhood is not null;
    v_took_hood := found;

    -- The tags, as a set: only into an account that has none.
    if not exists (select 1 from public.person_tags where person_id = v_b)
       and exists (select 1 from public.person_tags where person_id = v_a) then
      update public.person_tags set person_id = v_b where person_id = v_a;
      v_took_tags := true;
    end if;

    -- The photo: only into an account that has none (checked again, as V6 requires).
    if v_take_photo then
      update public.people set photo_path = p_photo_dest where id = v_b and photo_path is null;
    end if;

    -- Everything not moved goes with the person.
    delete from public.people where id = v_a;
  end if;
  delete from auth.users where id = p_anon;
  return jsonb_build_object('rehomed', false, 'moved', v_moved, 'merged', v_merged, 'photo', v_take_photo, 'details', v_took_details,
                            'neighbourhood', v_took_hood, 'tags', v_took_tags);
end;
$$;
