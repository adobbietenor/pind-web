-- M3.3 — a withdrawn gathering's group stays, with names, and #3 tells it (Alex, 6 Oct
-- 2026; visibility.md V20/V21).
--
-- Before: a withdrawn gathering's room went dark at once (right — the list is gone), and
-- its groups kept their thread but their members lost each other's names and faces,
-- because seeing someone needed the gathering published. Alex: "the moment a gathering
-- is withdrawn is the exact moment people who had agreed to meet most need to say 'still
-- on?' — and that group is the only place real commitment ever happened."
--
-- Now:
--   * **people in a group together see each other** while the group is forming, set or
--     live — never across a block, never a hidden person, never a seed person to anyone
--     but a tester. Before a gathering this adds nothing (both are on the list already);
--     it is what keeps the names when the list goes;
--   * the group **stays writable until its normal deadline** — unchanged: the lifecycle
--     job still closes a forming group under 3 at its deadline and ends the rest at the
--     effective end, and posting stays open until 24 h after it;
--   * **#3 tells each member** the moment the gathering is withdrawn. (The date-change half
--     of #3 is M3.5's.)

create or replace function private.after_peer(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select me.id <> p_target
       and not private.blocked_between(me.id, p_target)
       and exists (
         select 1 from public.people t
         where t.id = p_target and t.hidden_at is null and (not t.is_seed or private.i_am_tester())
       )
       and (
         private.are_connected(p_target)
         or exists (
           select 1 from public.crew_members mine
           join public.crew_members theirs on theirs.crew_id = mine.crew_id
           join public.crews c on c.id = mine.crew_id
           where mine.person_id = me.id and mine.left_at is null
             and theirs.person_id = p_target and theirs.left_at is null
             and (private.after_open(mine.crew_id) or c.state in ('forming', 'spot_set', 'live'))
         )
       )
    from (select private.me() as id) me
    where me.id is not null
  ), false);
$$;

create function private.gatherings_notify_withdrawn() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.withdrawn_at is null or old.withdrawn_at is not null then
    return new;
  end if;
  insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
  select m.person_id, 'plan_status', new.id, c.id, new.name,
         -- PROPOSED copy (Tatiana's to reword).
         new.name || ' has been called off. Your group is still here if you want to talk it over.',
         '/group/' || c.id
  from public.crews c
  join public.crew_members m on m.crew_id = c.id and m.left_at is null
  join public.people p on p.id = m.person_id
  where c.gathering_id = new.id and c.state in ('forming', 'spot_set', 'live')
    and p.hidden_at is null
    and private.wants(m.person_id, 'plan_status');
  return new;
end;
$$;
revoke all on function private.gatherings_notify_withdrawn() from public;

create trigger gatherings_notify_withdrawn after update of withdrawn_at on public.gatherings
  for each row execute function private.gatherings_notify_withdrawn();
