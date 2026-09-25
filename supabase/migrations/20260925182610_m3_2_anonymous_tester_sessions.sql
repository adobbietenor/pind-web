-- M3.2 — anonymous tester sessions, so the stranger's path can be walked on the test
-- crowd (Alex, M3.2).
--
-- The testers list keys on a signed-in account, and an anonymous user cannot see the
-- seed gathering — so a tester could never walk A8 → pin → A27 with the email code on
-- the test crowd. The admin's "Start an anonymous tester session in this browser"
-- makes a FRESH anonymous user, adds it here, and hands it to the admin's browser
-- through the quick pin's sealed cookie, which the app claims as usual.
--
-- Alex's conditions, enforced in the database:
--   * **it only ever makes anonymous testers** — `admin_add_anonymous_tester` refuses
--     any account that is not anonymous; it never touches a permanent one (P123);
--   * **what it makes is visible and clearable** — `admin_anonymous_testers` lists
--     them, `admin_clear_anonymous_tester` deletes the whole anonymous user (which ends
--     the session), and the nightly clean-up removes any still anonymous after three
--     days (P125). One that finished A27 is a permanent account by then and stays on
--     the testers list, visible and removable like any other;
--   * **service key only** — no visitor can call any of them (P124).

create function public.admin_add_anonymous_tester(p_user uuid, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users where id = p_user and is_anonymous) then
    raise exception 'refused: only an anonymous user can be made an anonymous tester' using errcode = '22023';
  end if;
  insert into private.testers (auth_user_id, added_by, note)
  values (p_user, p_actor, 'anonymous-tester-session')
  on conflict (auth_user_id) do nothing;
end;
$$;

create function public.admin_anonymous_testers()
returns table (auth_user_id uuid, added_at timestamptz, still_anonymous boolean, email text, first_name text)
language sql stable security definer set search_path = '' as $$
  select t.auth_user_id, t.added_at, coalesce(u.is_anonymous, false), u.email::text, p.first_name
  from private.testers t
  join auth.users u on u.id = t.auth_user_id
  left join public.people p on p.auth_user_id = t.auth_user_id
  where t.note = 'anonymous-tester-session'
  order by t.added_at desc;
$$;

-- Clearing a session deletes the anonymous user — the only way to end a session held
-- in a browser — with their person and pins. Refuses an account that became permanent.
create function public.admin_clear_anonymous_tester(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from private.testers t join auth.users u on u.id = t.auth_user_id
    where t.auth_user_id = p_user and t.note = 'anonymous-tester-session' and u.is_anonymous
  ) then
    raise exception 'refused: not a still-anonymous tester session' using errcode = '22023';
  end if;
  delete from public.people where auth_user_id = p_user;
  delete from auth.users where id = p_user;
end;
$$;

create function public.admin_clear_stale_anonymous_testers(p_older_than interval default interval '3 days') returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_n integer := 0;
begin
  for v_user in
    select t.auth_user_id from private.testers t join auth.users u on u.id = t.auth_user_id
    where t.note = 'anonymous-tester-session' and u.is_anonymous and t.added_at < now() - p_older_than
  loop
    delete from public.people where auth_user_id = v_user;
    delete from auth.users where id = v_user;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.admin_add_anonymous_tester(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_anonymous_testers() from public, anon, authenticated;
revoke all on function public.admin_clear_anonymous_tester(uuid) from public, anon, authenticated;
revoke all on function public.admin_clear_stale_anonymous_testers(interval) from public, anon, authenticated;
grant execute on function public.admin_add_anonymous_tester(uuid, text) to service_role;
grant execute on function public.admin_anonymous_testers() to service_role;
grant execute on function public.admin_clear_anonymous_tester(uuid) to service_role;
grant execute on function public.admin_clear_stale_anonymous_testers(interval) to service_role;

select cron.schedule('pind-clear-anonymous-testers', '45 9 * * *', $$select public.admin_clear_stale_anonymous_testers()$$);
