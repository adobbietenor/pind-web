-- M3.3 — the independent review, L9 (R85): deleting a message no longer broadcasts it
-- (Alex, 6 Oct 2026).
--
-- Realtime does not apply row security to DELETE events (Supabase's documented
-- behaviour), so every subscriber — even one with no session — received the id and the
-- moment of every deleted room message. Deleting your own message is now a removal: the
-- row is kept until the room's retention purge, its words are cleared at once, and it is
-- unreadable to everyone, its author included. The change is an UPDATE, which Realtime
-- filters by the same read rule as any message, so nobody outside the room hears of it.
-- For the person deleting, nothing changes: it is gone for everyone (Alex: "being unable
-- to take something back is the wrong default"). A report made earlier keeps its own
-- copy of the words (H9).
--
-- Group threads had a delete grant and policy but no screen that uses them; both go, so
-- a group message cannot produce a DELETE event either. The retention purge still
-- deletes rows (30 days after a room closes, as Q11 says): a residual, recorded in
-- visibility.md — ids of month-old messages in closed rooms.

alter table public.room_messages add column deleted_at timestamptz;

-- The words may be cleared only on a removed message.
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.room_messages'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%body%'
  loop
    execute format('alter table public.room_messages drop constraint %I', v_name);
  end loop;
end;
$$;
alter table public.room_messages add constraint room_messages_body_check
  check (deleted_at is not null or char_length(btrim(body)) between 1 and 500);

drop policy room_messages_delete_own on public.room_messages;
revoke delete on public.room_messages from authenticated;

drop policy room_messages_read on public.room_messages;
create policy room_messages_read on public.room_messages
  for select to authenticated using (
    deleted_at is null
    and (
      author_id = private.me()
      or (
        hidden_at is null
        and private.room_open_to_me(room_id)
        and private.room_peer(author_id, (select r.gathering_id from public.rooms r where r.id = room_id))
      )
    )
  );

create function public.delete_room_message(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.room_messages set deleted_at = now(), body = ''
  where id = p_message and author_id = private.me() and deleted_at is null;
  if not found then
    raise exception 'refused: not your message' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.delete_room_message(uuid) from public, anon;
grant execute on function public.delete_room_message(uuid) to authenticated;

drop policy crew_messages_delete_own on public.crew_messages;
revoke delete on public.crew_messages from authenticated;
