-- M3.3b — room placement takes a lock per gathering (Alex, 6 Oct 2026: "write the lock").
--
-- The gap was found answering V20's placement question (docs/visibility.md §12j): two
-- opt-ins at the same instant could put a room one over its size, and the first two ever
-- at a gathering could both create room 1, so that one person's opt-in failed on the
-- unique constraint. The lock is taken only for placing, held until the opt-in commits,
-- and only against other placements at the same gathering. Worst case, measured before
-- writing it: one placement is ~2 ms of database time, so the 40th of 40 simultaneous
-- opt-ins waits ~0.1–0.2 s. Proved by R98 (simultaneous opt-ins never overfill a room,
-- and the first two at an empty gathering both succeed).

create or replace function private.place_in_room(p_person uuid, p_gathering uuid, p_women_only boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_room uuid;
  v_size smallint := private.room_size(p_gathering);
begin
  -- Never a hidden person; never a seed person at a real gathering (L3, L5).
  if exists (select 1 from public.people p where p.id = p_person and p.hidden_at is not null)
     or exists (
       select 1 from public.people p, public.gatherings g
       where p.id = p_person and g.id = p_gathering and p.is_seed and not g.is_seed
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
