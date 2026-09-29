-- M3.3 — a group's deadline moves with the group, and a group under 3 can invite someone
-- else (Alex, 28 Sept 2026: "without it a declined invite is a silent dead end").
--
-- **The deadline.** As first built, every forming group under 3 closed at six hours
-- before the start — so a group started after that mark closed on the next ten-minute
-- run: it punished the person who did the thing we want. A group now closes, if it has
-- not reached 3, at the LATER of six hours before the start or two hours after it was
-- started — and never later than three hours before, when the plan is set. The screen
-- shows this time from the start ("If there aren't 3 of you by 5:00 pm…").
--
-- **Invite someone else.** While a group is forming and under 3, any member can invite
-- more people they have talked with in the room (the same `can_invite` rule). Growing a
-- group past 3 after it has formed stays in M3.6. Nobody is ever shown who has not
-- answered or who said no: a member sees who is in, never the invites.

create function public.group_closes_at(p_crew uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select least(greatest(g.starts_at - interval '6 hours', c.created_at + interval '2 hours'), g.starts_at - interval '3 hours')
  from public.crews c join public.gatherings g on g.id = c.gathering_id
  where c.id = p_crew
    and (private.in_group(p_crew) or coalesce(auth.role(), '') = 'service_role');
$$;
revoke all on function public.group_closes_at(uuid) from public, anon;
grant execute on function public.group_closes_at(uuid) to authenticated, service_role;

create function public.invite_more(p_crew uuid, p_invitees uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_crew public.crews;
  v_person uuid;
begin
  select * into v_crew from public.crews where id = p_crew;
  if v_crew.id is null or not private.in_group(p_crew) then
    raise exception 'refused: not your group' using errcode = '42501';
  end if;
  if v_crew.state <> 'forming' or private.active_members(p_crew) >= 3 then
    raise exception 'refused: this group is already on' using errcode = '42501';
  end if;
  if now() >= public.group_closes_at(p_crew) then
    raise exception 'refused: this group has closed' using errcode = '42501';
  end if;
  if coalesce(array_length(p_invitees, 1), 0) not between 1 and 3 then
    raise exception 'refused: invite 1 to 3 people' using errcode = '22023';
  end if;
  foreach v_person in array p_invitees loop
    if v_crew.room_id is null or not private.can_invite(v_crew.room_id, v_person) then
      raise exception 'refused: you can invite only people you have talked with here' using errcode = '42501';
    end if;
  end loop;
  insert into public.crew_invites (crew_id, gathering_id, from_person, to_person)
  select p_crew, v_crew.gathering_id, private.me(), x from unnest(p_invitees) x
  on conflict do nothing;
end;
$$;
revoke all on function public.invite_more(uuid, uuid[]) from public, anon;
grant execute on function public.invite_more(uuid, uuid[]) to authenticated;

-- The lifecycle job, with the moving deadline. Everything else as m3_3_groups_tick_plan.
create or replace function public.admin_groups_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expired int; v_dissolved int; v_planned int; v_live int; v_done int;
begin
  update public.crew_invites i set status = 'expired', decided_at = now()
  from public.gatherings g
  where g.id = i.gathering_id and i.status = 'sent' and now() >= g.starts_at;
  get diagnostics v_expired = row_count;

  -- Under 3 at its deadline (the later of −6 h and started + 2 h, never after −3 h):
  -- closed. Its people are still in the room.
  update public.crews c set state = 'dissolved', dissolved_at = now()
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'forming'
    and now() >= least(greatest(g.starts_at - interval '6 hours', c.created_at + interval '2 hours'), g.starts_at - interval '3 hours')
    and private.active_members(c.id) < 3;
  get diagnostics v_dissolved = row_count;
  update public.crew_members m set left_at = now()
  from public.crews c
  where c.id = m.crew_id and c.state = 'dissolved' and m.left_at is null;
  -- A closed group's open invites lapse with it.
  update public.crew_invites i set status = 'withdrawn', decided_at = now()
  from public.crews c
  where c.id = i.crew_id and c.state = 'dissolved' and i.status = 'sent';

  update public.crews c
  set state = 'spot_set',
      spot_id = (
        select p.spot_id from public.crew_proposals p
        where p.crew_id = c.id
        order by (select count(*) from public.crew_proposal_votes v where v.proposal_id = p.id) desc, p.meet_at, p.created_at
        limit 1
      ),
      meet_at = coalesce((
        select p.meet_at from public.crew_proposals p
        where p.crew_id = c.id
        order by (select count(*) from public.crew_proposal_votes v where v.proposal_id = p.id) desc, p.meet_at, p.created_at
        limit 1
      ), g.starts_at)
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'forming'
    and now() >= g.starts_at - interval '3 hours'
    and private.active_members(c.id) >= 3;
  get diagnostics v_planned = row_count;

  update public.crews c set state = 'live'
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'spot_set' and now() >= g.starts_at - interval '3 hours';
  get diagnostics v_live = row_count;

  update public.crews c set state = 'done'
  from public.gatherings g
  where g.id = c.gathering_id and c.state in ('spot_set', 'live') and now() >= public.effective_end(g);
  get diagnostics v_done = row_count;

  return jsonb_build_object('expired', v_expired, 'dissolved', v_dissolved, 'planned', v_planned, 'live', v_live, 'done', v_done);
end;
$$;
