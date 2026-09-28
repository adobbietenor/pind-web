-- M3.2 — bringing an anonymous pinner into the account they already have (Alex, M3.2).
--
-- At A27 an anonymous pinner enters an email that already has a Pin'd account. The
-- design Alex approved:
--
--   1. the app keeps the anonymous session and sends a sign-in code to the address;
--   2. the code proves the address — only then does the app hold the account's session;
--   3. the app presents BOTH sessions to the Worker (`POST /account/merge`), which
--      checks each with the auth server — both valid now, the first really anonymous,
--      the second really permanent, different people — before touching anything;
--   4. this function moves the anonymous person's pins into the account, in one
--      transaction, and deletes the anonymous person and user.
--
-- Nothing moves before the code. A stranger typing someone else's address never gets
-- the code, never holds the second session, and moves nothing. This function merges
-- only FROM an anonymous user and only INTO a permanent one, and only the service key
-- can call it — and the Worker calls it only with the two ids the auth server just
-- vouched for.
--
-- **Two pins at one gathering: the one being moved wins on party size**, the older row
-- goes, and the count does not double (Alex). "Open to meeting" stays as the account
-- had it: the moved pin cannot have been open (the opt-in gate). **An account with no
-- profile yet takes the anonymous person whole** (name, pins, 19+ record) — re-homed,
-- not copied.

create function public.admin_merge_anonymous(p_anon uuid, p_perm uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_anon_is boolean;
  v_perm_is boolean;
  v_a uuid;
  v_b uuid;
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

  select id into v_a from public.people where auth_user_id = p_anon;
  select id into v_b from public.people where auth_user_id = p_perm;

  if v_a is not null and v_b is null then
    -- The account has no profile: the anonymous person becomes it, whole.
    update public.people set auth_user_id = null where id = v_a;
    delete from auth.users where id = p_anon;
    update public.people set auth_user_id = p_perm where id = v_a;
    return jsonb_build_object('rehomed', true, 'moved', 0, 'merged', 0);
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
    delete from public.people where id = v_a;
  end if;
  delete from auth.users where id = p_anon;
  return jsonb_build_object('rehomed', false, 'moved', v_moved, 'merged', v_merged);
end;
$$;
revoke all on function public.admin_merge_anonymous(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_merge_anonymous(uuid, uuid) to service_role;
