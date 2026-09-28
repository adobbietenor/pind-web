-- M3.3 — the room (Alex, with Tatiana and Jayme, 28 Sept 2026; build plan §8 M3.3).
--
-- At every gathering, everyone open to meeting is in a room — a group chat — from the
-- second person on. Nobody starts it, joins it or approves anyone: opting in places you,
-- opting out takes you out. Up to 30 a room (a setting on the city); a new room opens
-- only when the others are full. Women, and nonbinary people who chose inclusion, are
-- also in a women-only room alongside (H7), opening at 3.
--
-- Who can see what (approved by Alex before this was written):
--   * **a room message** is readable by a member of the same room who could see its
--     author on the list — both opted in there, no block either way, neither hidden —
--     and by its author. Nobody else: not a visitor, not someone pinned without opting
--     in, not another room, not another gathering;
--   * **during the 30 read-only days** after the list closes (Q11) the rule is the same
--     minus the list's closing time: `private.room_peer` is `can_see_at` without
--     `list_open`'s "effective end + 24 h" cut-off, so the thread stays readable to the
--     same people, and nobody new;
--   * **posting**: only as yourself, only in your own room, only while you are opted in,
--     the room has two people in it and the gathering has not closed (effective end +
--     24 h); at most one message every 3 seconds and 200 a day, in the database;
--   * **deleting**: your own messages only (Alex: "being unable to take something back
--     is the wrong default"); a report made earlier keeps its snapshot;
--   * **membership rows** (the arrival cards): yours, and those of people in your room
--     you could see on the list;
--   * **the women-only room**: only the eligible (`is_women_only_eligible`) are placed in
--     it, so only they can read or post.
-- Nothing is ever sent for anyone: every row here is written by its author's own session.

-- ---------------------------------------------------------------------------
-- The setting
-- ---------------------------------------------------------------------------

alter table public.cities add column room_size smallint not null default 30 check (room_size between 2 and 200);
comment on column public.cities.room_size is
  'People per room at a gathering (M3.3). Thirty strangers is still one conversation; a new room opens when the others are full.';

-- ---------------------------------------------------------------------------
-- Rooms, members, messages
-- ---------------------------------------------------------------------------

create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  number        smallint not null check (number >= 1),
  women_only    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (gathering_id, women_only, number),
  unique (id, gathering_id)
);
alter table public.rooms enable row level security;

create table public.room_members (
  room_id          uuid not null,
  gathering_id     uuid not null,
  person_id        uuid not null references public.people (id) on delete cascade,
  women_only       boolean not null,
  joined_at        timestamptz not null default now(),
  left_at          timestamptz,
  -- For #6's batching: the first message since you last looked.
  last_seen_at     timestamptz,
  -- "Someone you've talked with": set by the first message you post here, and kept
  -- even if that message is deleted — it records the act (invites, M3.3).
  first_posted_at  timestamptz,
  primary key (room_id, person_id),
  foreign key (room_id, gathering_id) references public.rooms (id, gathering_id) on delete cascade
);
alter table public.room_members enable row level security;
-- One general room and at most one women-only room per person per gathering.
create unique index room_members_one_active_per_kind
  on public.room_members (gathering_id, person_id, women_only) where left_at is null;
create index room_members_room_active_idx on public.room_members (room_id) where left_at is null;

create table public.room_messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  author_id   uuid not null references public.people (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 500),
  -- Set when a safety report hides it (H9); the author still sees it.
  hidden_at   timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.room_messages enable row level security;
create index room_messages_room_created_idx on public.room_messages (room_id, created_at);
create index room_messages_author_created_idx on public.room_messages (author_id, created_at);

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- The room's read rule: can_see_at without the list's closing time (see the header).
create function private.room_peer(p_target uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select me.id <> p_target
       and private.is_published(p_gathering)
       and private.is_open_at(me.id, p_gathering)
       and private.is_open_at(p_target, p_gathering)
       and not private.blocked_between(me.id, p_target)
    from (select private.me() as id) me
    where me.id is not null
  ), false);
$$;
revoke all on function private.room_peer(uuid, uuid) from public;
grant execute on function private.room_peer(uuid, uuid) to authenticated;

-- I am in this room now.
create function private.in_room(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.person_id = private.me() and m.left_at is null
  );
$$;
revoke all on function private.in_room(uuid) from public;
grant execute on function private.in_room(uuid) to authenticated;

create function private.room_size(p_gathering uuid) returns smallint
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select c.room_size from public.gatherings g
    join public.venues v on v.id = g.venue_id
    join public.cities c on c.slug = v.city
    where g.id = p_gathering
  ), 30::smallint);
$$;
revoke all on function private.room_size(uuid) from public;

-- ---------------------------------------------------------------------------
-- Placement: opting in places you; opting out, or removing the pin, takes you out.
-- ---------------------------------------------------------------------------

create function private.place_in_room(p_person uuid, p_gathering uuid, p_women_only boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_room uuid;
  v_size smallint := private.room_size(p_gathering);
begin
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
revoke all on function private.place_in_room(uuid, uuid, boolean) from public;

create function private.leave_rooms(p_person uuid, p_gathering uuid) returns void
language sql security definer set search_path = '' as $$
  update public.room_members set left_at = now()
  where person_id = p_person and gathering_id = p_gathering and left_at is null;
$$;
revoke all on function private.leave_rooms(uuid, uuid) from public;

create function private.pins_place_in_rooms() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.leave_rooms(old.person_id, old.gathering_id);
    return old;
  end if;
  if new.open_to_meeting and (tg_op = 'INSERT' or not old.open_to_meeting) then
    perform private.place_in_room(new.person_id, new.gathering_id, false);
    if private.is_women_only_eligible(new.person_id) then
      perform private.place_in_room(new.person_id, new.gathering_id, true);
    end if;
  elsif tg_op = 'UPDATE' and old.open_to_meeting and not new.open_to_meeting then
    perform private.leave_rooms(new.person_id, new.gathering_id);
  end if;
  return new;
end;
$$;
revoke all on function private.pins_place_in_rooms() from public;

create trigger pins_place_in_rooms
  after insert or update of open_to_meeting or delete on public.pins
  for each row execute function private.pins_place_in_rooms();

-- People already open to meeting when this ships are placed now.
select private.place_in_room(p.person_id, p.gathering_id, false) from public.pins p where p.open_to_meeting;
select private.place_in_room(p.person_id, p.gathering_id, true)
from public.pins p where p.open_to_meeting and private.is_women_only_eligible(p.person_id);

-- ---------------------------------------------------------------------------
-- Posting: the room is open, you are in it, and not too fast.
-- ---------------------------------------------------------------------------

create function private.room_writable(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    join public.gatherings g on g.id = r.gathering_id
    where r.id = p_room
      and private.is_published(r.gathering_id)
      and now() < public.effective_end(g) + interval '24 hours'
      and (select count(*) from public.room_members m where m.room_id = r.id and m.left_at is null) >= 2
  );
$$;
revoke all on function private.room_writable(uuid) from public;
grant execute on function private.room_writable(uuid) to authenticated;

create function private.room_messages_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
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
revoke all on function private.room_messages_rate_limit() from public;
create trigger room_messages_rate_limit before insert on public.room_messages
  for each row execute function private.room_messages_rate_limit();

-- The first message you post in a room records that you have spoken there.
create function private.room_messages_first_post() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.room_members set first_posted_at = coalesce(first_posted_at, new.created_at)
  where room_id = new.room_id and person_id = new.author_id;
  return new;
end;
$$;
revoke all on function private.room_messages_first_post() from public;
create trigger room_messages_first_post after insert on public.room_messages
  for each row execute function private.room_messages_first_post();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

grant select on public.rooms to authenticated;
grant select on public.room_members to authenticated;
grant select, delete on public.room_messages to authenticated;
grant insert (room_id, author_id, body) on public.room_messages to authenticated;

create policy rooms_read_own on public.rooms
  for select to authenticated using (private.in_room(id));

create policy room_members_read on public.room_members
  for select to authenticated using (
    person_id = private.me()
    or (private.in_room(room_id) and left_at is null and private.room_peer(person_id, gathering_id))
  );

create policy room_messages_read on public.room_messages
  for select to authenticated using (
    author_id = private.me()
    or (
      hidden_at is null
      and private.in_room(room_id)
      and private.room_peer(author_id, (select r.gathering_id from public.rooms r where r.id = room_id))
    )
  );

create policy room_messages_post on public.room_messages
  for insert to authenticated with check (
    author_id = private.me()
    and private.in_room(room_id)
    and private.room_writable(room_id)
  );

create policy room_messages_delete_own on public.room_messages
  for delete to authenticated using (author_id = private.me());

-- "You last looked": for #6's batching. Your own row only.
create function public.room_seen(p_room uuid) returns void
language sql security definer set search_path = '' as $$
  update public.room_members set last_seen_at = now()
  where room_id = p_room and person_id = private.me() and left_at is null;
$$;
revoke all on function public.room_seen(uuid) from public, anon;
grant execute on function public.room_seen(uuid) to authenticated;

-- Where you are at a gathering, with honest counts (H6): every active member, not only
-- the ones you can see. "Open" is two or more.
create function public.my_rooms(p_gathering uuid)
returns table (room_id uuid, number smallint, women_only boolean, members integer, open boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.number, r.women_only, c.n, c.n >= 2
  from public.room_members me
  join public.rooms r on r.id = me.room_id
  cross join lateral (
    select count(*)::integer as n from public.room_members m where m.room_id = r.id and m.left_at is null
  ) c
  where me.person_id = private.me() and me.gathering_id = p_gathering and me.left_at is null
    -- A women-only room opens at 3 (H7, Q9); it is not offered before.
    and (not r.women_only or c.n >= 3)
  order by r.women_only;
$$;
revoke all on function public.my_rooms(uuid) from public, anon;
grant execute on function public.my_rooms(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reports on a room message (H9): snapshot the text, hide it at once on a safety reason.
-- ---------------------------------------------------------------------------

alter table public.reports add column target_room_message_id uuid references public.room_messages (id) on delete set null;
alter table public.reports drop constraint reports_at_most_one_target;
alter table public.reports add constraint reports_at_most_one_target
  check (num_nonnulls(target_person_id, target_crew_id, target_message_id, target_room_message_id) <= 1);
alter table public.reports drop constraint reports_target_matches_kind;
alter table public.reports add constraint reports_target_matches_kind check (
      (target_person_id       is null or target_kind = 'person')
  and (target_crew_id         is null or target_kind = 'crew')
  and (target_message_id      is null or target_kind = 'message')
  and (target_room_message_id is null or target_kind = 'message')
);
create index reports_target_room_message_id_idx on public.reports (target_room_message_id);

create or replace function public.snapshot_reported_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.reported_content_snapshot := null;
  if new.target_message_id is not null then
    select m.body into new.reported_content_snapshot from public.crew_messages m where m.id = new.target_message_id;
  elsif new.target_room_message_id is not null then
    select m.body into new.reported_content_snapshot from public.room_messages m where m.id = new.target_room_message_id;
  end if;
  return new;
end;
$$;

create function private.reports_hide_room_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.target_room_message_id is not null and new.is_safety then
    update public.room_messages set hidden_at = now() where id = new.target_room_message_id and hidden_at is null;
  end if;
  return new;
end;
$$;
revoke all on function private.reports_hide_room_message() from public;
create trigger reports_hide_room_message after insert on public.reports
  for each row execute function private.reports_hide_room_message();

grant insert (target_room_message_id) on public.reports to authenticated;
create policy reports_insert_on_readable_room_message on public.reports
  for insert to authenticated with check (
    reporter_id = private.me()
    and target_kind = 'message'
    and target_room_message_id is not null
    and exists (
      select 1 from public.room_messages m
      where m.id = target_room_message_id
        and m.author_id <> private.me()
        and private.in_room(m.room_id)
        and private.room_peer(m.author_id, (select r.gathering_id from public.rooms r where r.id = m.room_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Retention (Q11): read-only from effective end + 24 h, deleted 30 days after that.
-- ---------------------------------------------------------------------------

create function public.admin_delete_expired_room_messages() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.room_messages m
  using public.rooms r, public.gatherings g
  where r.id = m.room_id and g.id = r.gathering_id
    and now() >= public.effective_end(g) + interval '24 hours' + interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.admin_delete_expired_room_messages() from public, anon, authenticated;
grant execute on function public.admin_delete_expired_room_messages() to service_role;
select cron.schedule('pind-delete-expired-room-messages', '15 9 * * *', $$select public.admin_delete_expired_room_messages()$$);

-- Realtime through postgres_changes, which respects RLS (never broadcast).
alter publication supabase_realtime add table public.room_messages;
