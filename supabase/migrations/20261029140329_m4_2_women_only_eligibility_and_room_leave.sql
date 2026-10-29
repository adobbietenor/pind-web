-- M4.2 fixes (29 Oct 2026), approved by Alex as a batch (decisions, "M4.2: the review fixes").
--
-- R1 — WOMEN ONLY IN 1-ON-1 NEEDS ELIGIBILITY. Only a woman, or a nonbinary person who chose
--   to be included, can choose "women only" for 1-on-1, as for squads. A man choosing it was
--   shown exactly the eligible people and read their gender off the difference (R1/R1b).
--   Someone who stops being eligible has 1-on-1 turned OFF where they had chosen women only —
--   never widened to "everyone" (Alex: "silently making someone visible to more people than
--   they chose must never happen by default") — and their pending proposals close silently.
--
-- F3 — ELIGIBILITY LOST, WOMEN-ONLY SPACES LEFT. A gender change, or a nonbinary person
--   turning "include me" off, takes them out of every women-only room and women-only squad
--   at once: no reading, no posting, not listed. Their earlier messages stay (they were
--   eligible when they wrote them — Alex). The probe found it in the room too: still a member,
--   reading, listed and able to post (F3-room).
--
-- THE DEPARTURE IS SILENT, AND NOT ALONE (Alex, 29 Oct). No departure is ever announced —
--   no line, no notification, no reason stored (membership keeps only joined_at and left_at).
--   But rooms had no Leave: the only ways out took you out of BOTH rooms, so "gone from the
--   women-only room, still in the general one" could only mean an eligibility change — a
--   gender change, readable. So the women-only room gains an ordinary Leave that keeps you in
--   the general room (leave_women_only_room), and leaving is remembered so placement does not
--   put you back (`place_in_room`), until you choose "women-only rooms only" again.
--
-- Every change to a person's women-only standing takes that person's lock first
-- (private.lock_people, 20261029140204), as joins and placements do.

-- ---------------------------------------------------------------------------
-- R1: the choice
-- ---------------------------------------------------------------------------

create function private.pins_women_only_needs_eligibility() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.solo_visibility = 'women_only'
     and (tg_op = 'INSERT' or old.solo_visibility is distinct from 'women_only')
     and not private.is_women_only_eligible(new.person_id) then
    raise exception 'Women only is for women, and nonbinary people who chose to be included.'
      using errcode = '42501', hint = 'solo_women_only_ineligible';
  end if;
  return new;
end;
$$;
revoke all on function private.pins_women_only_needs_eligibility() from public;

-- Named to run after pins_solo_follows_meeting (triggers fire in name order), which clears
-- the choice when 1-on-1 is off: only a choice that survives is checked.
create trigger pins_women_only_needs_eligibility
  before insert or update of solo_visibility, solo_opt_in on public.pins
  for each row execute function private.pins_women_only_needs_eligibility();

-- Anyone already holding the choice without being eligible: 1-on-1 off there (their
-- proposals close through pins_solo_closes_proposals, as switching off always has).
update public.pins p set solo_opt_in = false
where p.solo_visibility = 'women_only' and not private.is_women_only_eligible(p.person_id);

-- ---------------------------------------------------------------------------
-- The women-only room's Leave, remembered where no one else reads it
-- ---------------------------------------------------------------------------

create table private.women_only_room_leaves (
  person_id     uuid not null references public.people (id) on delete cascade,
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  left_at       timestamptz not null default now(),
  primary key (person_id, gathering_id)
);
alter table private.women_only_room_leaves enable row level security;
revoke all on private.women_only_room_leaves from public, anon, authenticated;
comment on table private.women_only_room_leaves is
  'Who left a gathering''s women-only room by choice (M4.2). Placement does not put them back. Read by nobody but the database; the room''s members see only that a card went, as for any departure.';

create function public.leave_women_only_room(p_gathering uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if v_me is null then
    raise exception 'refused: no person' using errcode = '42501';
  end if;
  perform private.lock_people(array[v_me]);
  insert into private.women_only_room_leaves (person_id, gathering_id) values (v_me, p_gathering)
  on conflict (person_id, gathering_id) do nothing;
  update public.room_members set left_at = now()
  where person_id = v_me and gathering_id = p_gathering and women_only and left_at is null;
end;
$$;
revoke all on function public.leave_women_only_room(uuid) from public, anon;
grant execute on function public.leave_women_only_room(uuid) to authenticated;

-- Placement: as 20261007001216, with the person's lock (a gender change cannot interleave
-- with a placement) and a women-only room never chosen for someone who left it.
create or replace function private.place_in_room(p_person uuid, p_gathering uuid, p_women_only boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_room uuid;
  v_size smallint := private.room_size(p_gathering);
begin
  perform private.lock_people(array[p_person]);
  -- Never a hidden person; never a seed person at a real gathering (L3, L5).
  if exists (select 1 from public.people p where p.id = p_person and p.hidden_at is not null)
     or exists (
       select 1 from public.people p, public.gatherings g
       where p.id = p_person and g.id = p_gathering and p.is_seed and not g.is_seed
     ) then
    return null;
  end if;
  -- Never back into a women-only room you left (M4.2), nor into one you are not eligible for.
  if p_women_only and (
       exists (select 1 from private.women_only_room_leaves l where l.person_id = p_person and l.gathering_id = p_gathering)
       or not private.is_women_only_eligible(p_person)
     ) then
    return null;
  end if;
  -- One placement at a time per gathering (Alex, 6 Oct 2026): without it, two opt-ins at
  -- the same instant could both see 29 and make 31, or — the first two ever — both make
  -- room 1 and one of them be refused. Measured on staging: a placement costs ~2 ms in
  -- the database, so 40 people opting in at the same instant wait ~0.1–0.2 s at most.
  perform pg_advisory_xact_lock(hashtext('room_placement:' || p_gathering::text));
  select m.room_id into v_room from public.room_members m
  where m.gathering_id = p_gathering and m.person_id = p_person and m.women_only = p_women_only and m.left_at is null;
  if v_room is not null then
    return v_room;
  end if;
  -- Back to a room you were in, if it has space; otherwise the fullest room with space.
  select r.id into v_room
  from public.rooms r
  join public.room_members old on old.room_id = r.id and old.person_id = p_person
  where r.gathering_id = p_gathering and r.women_only = p_women_only
    and (select count(*) from public.room_members m where m.room_id = r.id and m.left_at is null) < v_size
  limit 1;
  if v_room is not null then
    update public.room_members set left_at = null, joined_at = now()
    where room_id = v_room and person_id = p_person;
    return v_room;
  end if;
  select r.id into v_room
  from public.rooms r
  left join public.room_members m on m.room_id = r.id and m.left_at is null
  where r.gathering_id = p_gathering and r.women_only = p_women_only
  group by r.id, r.number
  having count(m.person_id) < v_size
  order by count(m.person_id) desc, r.number
  limit 1;
  if v_room is null then
    insert into public.rooms (gathering_id, number, women_only)
    values (
      p_gathering,
      coalesce((select max(number) from public.rooms where gathering_id = p_gathering and women_only = p_women_only), 0) + 1,
      p_women_only
    )
    returning id into v_room;
  end if;
  insert into public.room_members (room_id, gathering_id, person_id, women_only)
  values (v_room, p_gathering, p_person, p_women_only);
  return v_room;
end;
$$;

-- "Women-only rooms only", switched on, is an explicit choice to be in those rooms: it
-- forgets any Leave first. Otherwise as 20260929031538, with the person's lock.
create or replace function public.set_women_only_rooms(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  r record;
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  perform private.lock_people(array[v_me]);
  if p_on and not private.is_women_only_eligible(v_me) then
    raise exception 'refused: not eligible' using errcode = '42501';
  end if;
  if p_on then
    delete from private.women_only_room_leaves where person_id = v_me;
  end if;
  update public.people_private set women_only_rooms = p_on where person_id = v_me;
  for r in
    select p.gathering_id from public.pins p join public.gatherings g on g.id = p.gathering_id
    where p.person_id = v_me and p.open_to_meeting and public.effective_end(g) > now()
  loop
    if p_on then
      update public.room_members set left_at = now()
      where person_id = v_me and gathering_id = r.gathering_id and not women_only and left_at is null;
      perform private.place_in_room(v_me, r.gathering_id, true);
    else
      perform private.place_in_room(v_me, r.gathering_id, false);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- F3 and R1: eligibility lost
-- ---------------------------------------------------------------------------

create function private.people_private_eligibility_lost() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (old.gender = 'woman' or (old.gender = 'nonbinary' and old.include_in_women_only))
     and not (new.gender = 'woman' or (new.gender = 'nonbinary' and new.include_in_women_only)) then
    perform private.lock_people(array[new.person_id]);
    -- Out of every women-only room — the same left_at any departure writes, nothing else.
    update public.room_members set left_at = now()
    where person_id = new.person_id and women_only and left_at is null;
    -- Out of every women-only squad that has not ended.
    update public.crew_members m set left_at = now()
    from public.crews c
    where c.id = m.crew_id and m.person_id = new.person_id and m.left_at is null
      and c.kind = 'crew' and c.women_only and c.state <> 'dissolved';
    -- 1-on-1 off wherever "women only" was the choice: never widened (R1).
    update public.pins set solo_opt_in = false
    where person_id = new.person_id and solo_visibility = 'women_only';
  end if;
  return new;
end;
$$;
revoke all on function private.people_private_eligibility_lost() from public;

create trigger people_private_eligibility_lost
  after update of gender, include_in_women_only on public.people_private
  for each row execute function private.people_private_eligibility_lost();
