-- M3.3 — the independent review: hidden people and seed people in rooms (Alex, 6 Oct 2026).
--
-- L3/L4 (R47h, R48h, R49): a person hidden by moderation could still opt in, be placed in
-- a room, be announced by name in #2 ("Zh's going to X too — say hi" — naming someone the
-- reader cannot see), and ping the room with #6 for messages nobody could read. Now:
--   * a hidden person is never placed in a room, and the moment they are hidden they are
--     taken out of every room they are in; unhidden, they are placed again wherever their
--     pin is open to meeting and the list is still open;
--   * neither #2 nor #6 is ever caused by, or names, a hidden person.
-- Their messages already in a room are unchanged here: they were unreadable to everyone
-- but the author from the moment of the hide (the read rule needs the author visible),
-- and what should become of them is Alex's call (6 Oct, open).
--
-- L5 (R81–R83): a seed person pinned to a real gathering would be counted in its room,
-- announced to real people by #2, and counted toward the women-only room's 3. Placement
-- now refuses a seed person at a gathering that is not seed — the room's version of what
-- P98 holds for the list.

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

-- Hidden: out of every room. Unhidden: back in, wherever the pin is open and the list is.
create function private.people_hidden_rooms() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_pin record;
begin
  if new.hidden_at is not null and old.hidden_at is null then
    update public.room_members set left_at = now() where person_id = new.id and left_at is null;
  elsif new.hidden_at is null and old.hidden_at is not null then
    for v_pin in
      select pi.gathering_id from public.pins pi join public.gatherings g on g.id = pi.gathering_id
      where pi.person_id = new.id and pi.open_to_meeting
        and g.published_at is not null and g.withdrawn_at is null
        and now() < public.effective_end(g) + interval '24 hours'
    loop
      if not private.women_only_rooms_only(new.id) then
        perform private.place_in_room(new.id, v_pin.gathering_id, false);
      end if;
      if private.is_women_only_eligible(new.id) then
        perform private.place_in_room(new.id, v_pin.gathering_id, true);
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.people_hidden_rooms() from public;

create trigger people_hidden_rooms after update of hidden_at on public.people
  for each row execute function private.people_hidden_rooms();

-- #2 never caused by, or naming, a hidden person (a guard behind placement's).
create or replace function private.notify_room_open() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_women boolean;
  v_needed integer;
  v_name text;
  v_body text;
begin
  if new.left_at is not null or (tg_op = 'UPDATE' and old.left_at is null) then
    return new;
  end if;
  if exists (select 1 from public.people p where p.id = new.person_id and p.hidden_at is not null) then
    return new;
  end if;
  select r.women_only into v_women from public.rooms r where r.id = new.room_id;
  select count(*) into v_count from public.room_members m where m.room_id = new.room_id and m.left_at is null;
  v_needed := case when v_women then 3 else 2 end;
  if v_count <> v_needed then
    return new;
  end if;
  select p.first_name into v_name from public.people p where p.id = new.person_id;
  v_body := case when v_women
    then 'The women-only room for ' || private.gathering_name(new.gathering_id) || ' is open — say hi'
    else v_name || '''s going to ' || private.gathering_name(new.gathering_id) || ' too — say hi' end;
  insert into public.notifications (person_id, kind, gathering_id, room_id, title, body, path)
  select m.person_id, 'room_open', new.gathering_id, new.room_id,
         private.gathering_name(new.gathering_id), v_body, private.crowd_path(new.gathering_id)
  from public.room_members m
  join public.people them on them.id = m.person_id
  where m.room_id = new.room_id and m.left_at is null and m.person_id <> new.person_id
    and them.hidden_at is null
    and not private.blocked_between(m.person_id, new.person_id)
    and private.wants(m.person_id, 'room_open')
  on conflict do nothing;
  return new;
end;
$$;

-- #6 never for a hidden author's message.
create or replace function private.notify_room_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_gathering uuid;
begin
  if exists (select 1 from public.people p where p.id = new.author_id and p.hidden_at is not null) then
    return new;
  end if;
  select r.gathering_id into v_gathering from public.rooms r where r.id = new.room_id;
  insert into public.notifications (person_id, kind, gathering_id, room_id, title, body, path)
  select m.person_id, 'room_activity', v_gathering, new.room_id,
         private.gathering_name(v_gathering),
         'New messages in the ' || private.gathering_name(v_gathering) || ' room',
         private.crowd_path(v_gathering)
  from public.room_members m
  join public.people them on them.id = m.person_id
  where m.room_id = new.room_id and m.left_at is null and m.person_id <> new.author_id
    and them.hidden_at is null
    and not private.blocked_between(m.person_id, new.author_id)
    and private.wants(m.person_id, 'room_activity')
    and (m.last_seen_at is null or m.last_seen_at < now() - interval '2 minutes')
    and not exists (
      select 1 from public.notifications n
      where n.person_id = m.person_id and n.room_id = new.room_id and n.kind = 'room_activity'
        and n.created_at > least(now() - interval '1 hour', coalesce(m.last_seen_at, '-infinity'::timestamptz))
    );
  return new;
end;
$$;

-- Anyone already in a room who should not be: out.
update public.room_members m set left_at = now()
from public.people p
where p.id = m.person_id and m.left_at is null and p.hidden_at is not null;

update public.room_members m set left_at = now()
from public.people p, public.gatherings g
where p.id = m.person_id and g.id = m.gathering_id and m.left_at is null and p.is_seed and not g.is_seed;
