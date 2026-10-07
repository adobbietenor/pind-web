-- M3.3 — the independent review, L10 and L11 (Alex, 6 Oct 2026).
--
-- L10 (R90): of 8 posts sent at the same moment, 2 got through the "one every 3 seconds"
-- check, because each read the table before the other had written. Each person's posts are
-- now checked one at a time: a lock per author, held until the post commits. The 200-a-
-- day count is inside the same lock. (The five-invites-a-day cap, R89, got its lock in
-- 20261006230939. Placement's lock per gathering waits on Alex's answer about the
-- worst-case wait.)
--
-- L11 (R91): people in a room could read each other's `last_seen_at` — when each last
-- looked, a read receipt the screen never shows. It is no longer readable by anyone
-- through the API; the database's own jobs (#6's batching) still use it. Join time stays
-- readable: arrivals are announced in the room anyway.

create or replace function private.room_messages_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('room_messages:' || new.author_id::text));
  if exists (
    select 1 from public.room_messages m
    where m.author_id = new.author_id and m.created_at > now() - interval '3 seconds'
  ) then
    raise exception 'slow down: one message every 3 seconds' using errcode = '23514';
  end if;
  if (select count(*) from public.room_messages m
      where m.author_id = new.author_id and m.created_at > now() - interval '24 hours') >= 200 then
    raise exception 'that is 200 messages today' using errcode = '23514';
  end if;
  new.created_at := now();
  new.hidden_at := null;
  return new;
end;
$$;

revoke select on public.room_members from authenticated;
grant select (room_id, gathering_id, person_id, women_only, joined_at, left_at, first_posted_at)
  on public.room_members to authenticated;
