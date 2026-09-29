-- M3.3 — notification #3, "groups and plans", written at the moment each thing happens
-- (spec A18 #3; Alex, 28 Sept: a group that closes under 3 must say so plainly and offer
-- something to do — "a dead end wearing good manners" otherwise).
--
--   * an invite arrives            → the invitee: "Maya wants to go together to Leafs vs Bruins"
--   * a group closes under 3       → every member, the same words for all, attributing
--                                     nothing: "Not enough people joined your group for
--                                     Leafs vs Bruins, so it's closed. You're all still in
--                                     the room."
--   * a group's plan is set        → every member: "Your group meets at Spot B, 6:00 pm"
--                                     or "at the start".
-- Never to a hidden person or across a block; off by the person's "Groups and plans"
-- switch. The inviter is never told of a decline — there is no row for it.

create function private.notify_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
  select new.to_person, 'plan_status', new.gathering_id, new.crew_id,
         private.gathering_name(new.gathering_id),
         f.first_name || ' wants to go together to ' || private.gathering_name(new.gathering_id),
         private.crowd_path(new.gathering_id)
  from public.people f, public.people t
  where f.id = new.from_person and t.id = new.to_person
    and t.hidden_at is null
    and not private.blocked_between(new.from_person, new.to_person)
    and private.wants(new.to_person, 'plan_status');
  return new;
end;
$$;
revoke all on function private.notify_invite() from public;
create trigger crew_invites_notify after insert on public.crew_invites
  for each row execute function private.notify_invite();

create function private.notify_group_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_body text;
  v_spot text;
begin
  if new.state = old.state then
    return new;
  end if;
  if new.state = 'dissolved' then
    v_body := 'Not enough people joined your group for ' || private.gathering_name(new.gathering_id)
      || ', so it''s closed. You''re all still in the room.';
  elsif new.state = 'spot_set' then
    select s.name into v_spot from public.meeting_spots s where s.id = new.spot_id;
    v_body := 'Your group for ' || private.gathering_name(new.gathering_id) || ' meets '
      || case when v_spot is null then 'at the start' else 'at ' || v_spot end || '.';
  else
    return new;
  end if;
  -- Everyone who was in it at that moment (a dissolve releases people in the same run,
  -- so members who left at or after the change are included).
  insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
  select m.person_id, 'plan_status', new.gathering_id, new.id,
         private.gathering_name(new.gathering_id), v_body, private.crowd_path(new.gathering_id)
  from public.crew_members m
  join public.people p on p.id = m.person_id
  where m.crew_id = new.id and (m.left_at is null or m.left_at >= now() - interval '1 minute')
    and p.hidden_at is null
    and private.wants(m.person_id, 'plan_status');
  return new;
end;
$$;
revoke all on function private.notify_group_change() from public;
create trigger crews_notify_change after update of state on public.crews
  for each row execute function private.notify_group_change();
