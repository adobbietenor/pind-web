-- M3.2 — the clean-up of stale anonymous tester sessions can be limited to one user.
--
-- P125 proves the clean-up by running it with a zero cutoff, which would clear EVERY
-- anonymous tester session on staging — including one Alex is walking with, if the
-- harness ran mid-walk. The test now names the one user it made; the nightly job
-- passes nothing and clears them all, as before.

drop function public.admin_clear_stale_anonymous_testers(interval);

create function public.admin_clear_stale_anonymous_testers(
  p_older_than interval default interval '3 days',
  p_only uuid default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_n integer := 0;
begin
  for v_user in
    select t.auth_user_id from private.testers t join auth.users u on u.id = t.auth_user_id
    where t.note = 'anonymous-tester-session'
      and u.is_anonymous
      and t.added_at < now() - p_older_than
      and (p_only is null or t.auth_user_id = p_only)
  loop
    delete from public.people where auth_user_id = v_user;
    delete from auth.users where id = v_user;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.admin_clear_stale_anonymous_testers(interval, uuid) from public, anon, authenticated;
grant execute on function public.admin_clear_stale_anonymous_testers(interval, uuid) to service_role;
