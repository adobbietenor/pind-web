-- M3.3 — the independent review, L6 (R23): the women-only room opens at 3 in the
-- database, not only on the screen (Alex, 6 Oct 2026).
--
-- `my_rooms` never offered a women-only room below 3, but the tables underneath used
-- `in_room` alone, and posting needed only 2. So the two eligible people at a gathering
-- with only two could read the room's row, both membership rows and each other's
-- messages, and post — learning the exact count ("2", which Q9 forbids next to the public
-- mix) and that the other person is eligible, a fact about their gender or their
-- inclusion choice that only they can otherwise read. Now a women-only room is readable
-- and writable only once 3 eligible people are in it. Your own membership row stays
-- yours to read: it tells you only what you already know about yourself.

create function private.room_open_to_me(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.in_room(p_room)
     and exists (
       select 1 from public.rooms r
       where r.id = p_room
         and (not r.women_only
              or (select count(*) from public.room_members m where m.room_id = r.id and m.left_at is null) >= 3)
     );
$$;
revoke all on function private.room_open_to_me(uuid) from public;
grant execute on function private.room_open_to_me(uuid) to authenticated;

drop policy rooms_read_own on public.rooms;
create policy rooms_read_own on public.rooms
  for select to authenticated using (private.room_open_to_me(id));

drop policy room_members_read on public.room_members;
create policy room_members_read on public.room_members
  for select to authenticated using (
    person_id = private.me()
    or (private.room_open_to_me(room_id) and left_at is null and private.room_peer(person_id, gathering_id))
  );

drop policy room_messages_read on public.room_messages;
create policy room_messages_read on public.room_messages
  for select to authenticated using (
    author_id = private.me()
    or (
      hidden_at is null
      and private.room_open_to_me(room_id)
      and private.room_peer(author_id, (select r.gathering_id from public.rooms r where r.id = room_id))
    )
  );

create or replace function private.room_writable(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    join public.gatherings g on g.id = r.gathering_id
    where r.id = p_room
      and private.is_published(r.gathering_id)
      and now() < public.effective_end(g) + interval '24 hours'
      and (select count(*) from public.room_members m where m.room_id = r.id and m.left_at is null)
          >= case when r.women_only then 3 else 2 end
  );
$$;

drop policy reports_insert_on_readable_room_message on public.reports;
create policy reports_insert_on_readable_room_message on public.reports
  for insert to authenticated with check (
    reporter_id = private.me()
    and target_kind = 'message'
    and target_room_message_id is not null
    and exists (
      select 1 from public.room_messages m
      where m.id = target_room_message_id
        and m.author_id <> private.me()
        and private.room_open_to_me(m.room_id)
        and private.room_peer(m.author_id, (select r.gathering_id from public.rooms r where r.id = m.room_id))
    )
  );
