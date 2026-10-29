-- M4.2 follow-up (29 Oct 2026): a hide ends an ACTIVE 1-on-1 plan through its own path.
--
-- 20261029140204 made a hide take a person out of every group in any state (F2). For an
-- active 1-on-1 plan that got there first, as an ordinary leave — which tells only the
-- partner — so when people_solo_follows_hide ran, the plan was already over and the hidden
-- person was never told their plan is off: a recorded exception Alex approved (decisions,
-- "M3.4: the brake and ending every plan"). P221 caught it on the first full run.
--
-- So the hide's removal leaves an active plan (forming, spot set or live) to
-- people_solo_follows_hide, which dissolves it and tells both, as before; it still takes the
-- person out of every squad in any state and out of a finished 1-on-1 plan.
create or replace function private.people_hidden_leave_squads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.hidden_at is null and new.hidden_at is not null then
    perform private.lock_people(array[new.id]);
    update public.crew_members m set left_at = now()
    from public.crews c
    where c.id = m.crew_id and m.person_id = new.id and m.left_at is null
      and c.state <> 'dissolved'
      and not (c.kind = 'solo' and c.state in ('forming', 'spot_set', 'live'));
  end if;
  return new;
end;
$$;
