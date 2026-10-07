-- M3.3 — fixes 20261006230939's invite read rule (P04, P151, 6 Oct 2026).
--
-- That rule called `private.blocked_between` inside a policy. Policies run as the person
-- asking, who may not execute it, so every read of `crew_invites` failed with "permission
-- denied" — for everyone, not only across a block. Granting `blocked_between` itself would
-- let a policy author ask about any two people; instead the rule asks the narrower
-- question it needs, about the caller alone, through a function that answers only that.

create function private.blocked_with_me(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.blocked_between(private.me(), p_person);
$$;
revoke all on function private.blocked_with_me(uuid) from public;
grant execute on function private.blocked_with_me(uuid) to authenticated;

drop policy crew_invites_read_invitee on public.crew_invites;
create policy crew_invites_read_invitee on public.crew_invites
  for select to authenticated using (
    to_person = private.me()
    and not private.blocked_with_me(from_person)
  );
