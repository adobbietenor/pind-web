-- M4.2 fixes from the independent reviews of 1-on-1 and squads (29 Oct 2026). Rules
-- approved by Alex as a batch the same day (decisions, "M4.2: the review fixes").
--
-- 1. ONE PERSON, ONE THING AT A TIME (R6, F4, the D1 race). Joining a squad, accepting a
--    1-on-1, a block, a hide and the "women-only rooms only" switch never interleave for the
--    same person: each takes that person's lock before it reads anything, so whichever lands
--    second sees the first. Found by racing two sessions (R6: a block racing an accept left a
--    plan standing across the block; RV13: the switch racing a join left her in a mixed
--    squad; probe D1-d: a block racing a join left the two in one squad, 2 tries in 20).
--    Under READ COMMITTED each statement after the lock takes a fresh snapshot, so the next
--    read sees what the other side committed while we waited.
--
--    A function that locks two people takes them in one fixed order (by id), so two of them
--    can never wait on each other.
--
-- 2. A HIDDEN PERSON IS GONE FROM EVERY GROUP AND ITS WORDS (F1, F2). V20's rule for the
--    room, now for squads and 1-on-1 chats too: a hidden person's messages are unreadable to
--    everyone but their author from the moment of the hide (and come back if they are
--    unhidden); a hidden person cannot post; and a hide takes them out of every group in any
--    state — a finished squad included, where they could read and post for 24 hours after
--    the night (RV09-F). My Events' previews and unread counts read through RLS (my_chats is
--    security invoker), so they follow.

-- ---------------------------------------------------------------------------
-- The lock
-- ---------------------------------------------------------------------------

create function private.lock_people(p_people uuid[]) returns void
language plpgsql set search_path = '' as $$
declare v uuid;
begin
  for v in select distinct x from unnest(p_people) x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('person:' || v::text, 0));
  end loop;
end;
$$;
revoke all on function private.lock_people(uuid[]) from public;

-- ---------------------------------------------------------------------------
-- R6: a block racing an accept. Both take the two people's locks first.
-- ---------------------------------------------------------------------------

create or replace function private.blocks_blocker_leaves_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- First, before anything is read: an accept or a join holding either person finishes,
  -- and the statements below see the plan or the membership it committed.
  perform private.lock_people(array[new.blocker_id, new.blocked_id]);
  update public.crew_members mine set left_at = now()
  from public.crew_members theirs, public.crews c
  where mine.person_id = new.blocker_id and mine.left_at is null
    and theirs.crew_id = mine.crew_id and theirs.person_id = new.blocked_id and theirs.left_at is null
    and c.id = mine.crew_id and c.state in ('forming', 'spot_set', 'live');
  -- Invites between the two lapse, whichever way they ran.
  update public.crew_invites set status = 'withdrawn', decided_at = now()
  where status = 'sent'
    and ((from_person = new.blocker_id and to_person = new.blocked_id)
      or (from_person = new.blocked_id and to_person = new.blocker_id));
  -- So do 1-on-1 proposals, at every gathering.
  perform private.close_solo_proposals(null, new.blocker_id, new.blocked_id);
  return new;
end;
$$;

create or replace function public.respond_to_solo(p_proposal uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.solo_proposals;
  v_from uuid;
  v_crew uuid;
begin
  -- Who the other person is, unlocked; then both people's locks, in one order (a block takes
  -- the same two), and only then the proposal and every check, read fresh.
  select p.from_person into v_from from public.solo_proposals p where p.id = p_proposal and p.to_person = private.me();
  if v_from is null then
    raise exception 'refused: no such proposal' using errcode = '42501';
  end if;
  perform private.lock_people(array[v_from, private.me()]);
  select * into v_p from public.solo_proposals
  where id = p_proposal and to_person = private.me() and status = 'open'
  for update;
  if v_p.id is null then
    raise exception 'refused: no such proposal' using errcode = '42501';
  end if;
  if not p_accept then
    update public.solo_proposals set status = 'declined', decided_at = now() where id = p_proposal;
    return null;
  end if;
  -- What sending checked, checked again now; the same words whatever changed (R59).
  if exists (select 1 from public.gatherings g where g.id = v_p.gathering_id and now() >= g.starts_at)
     or not private.can_see_solo(v_p.from_person, v_p.gathering_id)
     or not exists (select 1 from public.meeting_spots s where s.id = v_p.spot_id and s.active) then
    update public.solo_proposals set status = 'closed', decided_at = now() where id = p_proposal;
    raise exception 'refused: that proposal is no longer open' using errcode = '42501';
  end if;
  begin
    insert into public.crews (gathering_id, kind, state, spot_id, meet_at)
    values (v_p.gathering_id, 'solo', 'spot_set', v_p.spot_id, v_p.meet_at)
    returning id into v_crew;
    insert into public.crew_members (crew_id, gathering_id, person_id, kind)
    values (v_crew, v_p.gathering_id, v_p.from_person, 'solo'), (v_crew, v_p.gathering_id, v_p.to_person, 'solo');
  exception when unique_violation then
    -- Either of them made another 1-on-1 plan here at the same moment.
    raise exception 'refused: that proposal is no longer open' using errcode = '42501';
  end;
  update public.solo_proposals set status = 'accepted', decided_at = now(), crew_id = v_crew where id = p_proposal;
  -- One 1-on-1 plan per person per gathering: everything else pending for either closes.
  perform private.close_solo_proposals(v_p.gathering_id, v_p.from_person);
  perform private.close_solo_proposals(v_p.gathering_id, v_p.to_person);
  return v_crew;
end;
$$;

-- ---------------------------------------------------------------------------
-- F4 and the D1 race: joining or starting a squad takes the joiner's lock first, so a
-- block, a hide or the women-only switch on the same person is either already committed
-- (and refuses the join) or waits and then sees the membership (and takes them out).
-- ---------------------------------------------------------------------------

create or replace function public.join_squad(p_crew uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_c public.crews;
  v_seats smallint;
begin
  perform private.lock_people(array[v_me]);
  -- One join at a time per squad: the eighth seat is decided once.
  select * into v_c from public.crews where id = p_crew for update;
  if v_c.id is not null and private.in_group(p_crew) then
    return p_crew;
  end if;
  if v_me is null or v_c.id is null or not private.can_see_squad(p_crew) then
    raise exception 'refused: that squad is not open any more' using errcode = '42501', hint = 'squad_closed';
  end if;
  if private.in_a_group_at(v_me, v_c.gathering_id) then
    raise exception 'refused: already in a group here' using errcode = '42501', hint = 'squad_in_group';
  end if;
  v_seats := private.my_seats(v_me, v_c.gathering_id);
  if private.squad_seats(p_crew) + v_seats > 8 then
    raise exception 'refused: that squad is not open any more' using errcode = '42501', hint = 'squad_closed';
  end if;
  insert into public.crew_members (crew_id, gathering_id, person_id, seats)
  values (p_crew, v_c.gathering_id, v_me, v_seats);
  return p_crew;
end;
$$;

create or replace function private.women_only_leaves_mixed_squads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.women_only_rooms and not old.women_only_rooms then
    perform private.lock_people(array[new.person_id]);
    update public.crew_members m set left_at = now()
    from public.crews c
    where c.id = m.crew_id and m.person_id = new.person_id and m.left_at is null
      and c.kind = 'crew' and not c.legacy and not c.women_only and c.state in ('spot_set', 'live');
  end if;
  return new;
end;
$$;

-- F2, and the hide's half of the race: a hidden person leaves every group they are in, in
-- any state but already dissolved — a finished squad or 1-on-1 included. Leaving an active
-- 1-on-1 plan dissolves it, as it always has (people_solo_follows_hide does too).
create or replace function private.people_hidden_leave_squads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.hidden_at is null and new.hidden_at is not null then
    perform private.lock_people(array[new.id]);
    update public.crew_members m set left_at = now()
    from public.crews c
    where c.id = m.crew_id and m.person_id = new.id and m.left_at is null
      and c.state <> 'dissolved';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- F1 and F2: a hidden person's words, and their posting, in every group's chat
-- ---------------------------------------------------------------------------

-- Whether a message's author may be shown to others: there is one (system lines have none)
-- and they are not hidden. A hidden author's words return if they are unhidden (V20's
-- reversibility, as in the room).
create function private.author_shown(p_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_author is null
      or not exists (select 1 from public.people pe where pe.id = p_author and pe.hidden_at is not null);
$$;
revoke all on function private.author_shown(uuid) from public;
grant execute on function private.author_shown(uuid) to authenticated;

drop policy crew_messages_read_members on public.crew_messages;
create policy crew_messages_read_members on public.crew_messages
  for select to authenticated using (
    private.in_group(crew_id)
    and (author_id = private.me() or (hidden_at is null and private.author_shown(author_id)))
  );

drop policy crew_messages_post_members on public.crew_messages;
create policy crew_messages_post_members on public.crew_messages
  for insert to authenticated with check (
    author_id = private.me()
    and kind = 'user'
    and private.in_group(crew_id)
    and private.author_shown(author_id)
    and exists (
      select 1 from public.crews c join public.gatherings g on g.id = c.gathering_id
      where c.id = crew_id and c.state <> 'dissolved' and now() < public.effective_end(g) + interval '24 hours'
    )
  );
