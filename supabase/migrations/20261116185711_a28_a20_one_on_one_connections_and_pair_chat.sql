-- A9 / A28 / A29 / A20 / A22 — the 1-on-1 rebuild for build 23 (Alex, 16 Nov 2026).
--
-- In plain English (explained to and decided by Alex before this was written):
--
--   * Accepting a 1-on-1 makes the two of you CONNECTIONS at once (was: only keep-in-touch,
--     after the night). Connections see each other's profile and photo at any event, and the
--     Instagram handle (V17 already lets connections see it), until the connection ends.
--   * Every connected pair has ONE chat, `connection_messages`, read and written only by the
--     two of them, while neither has blocked the other and neither is hidden. It is the chat
--     the 1-on-1 opens, and the one "Message" opens from Connections for a keep-in-touch
--     connection too. It lasts as long as the connection (not Q11's 30-day event-chat purge —
--     recorded against Q11 in decisions.md). Mutual both ways, so never a cold DM (H2).
--   * The connection, and with it the chat, ends — silently, for both — when either of them:
--     removes it (remove_connection), calls off the 1-on-1, blocks the other, or reports the
--     other. Nobody is told; the other simply no longer has it.
--   * Requests can be sent and answered until the event's effective END, not only its start.
--   * No place or time is ever required: a venue with no meeting spots offers 1-on-1 too, and
--     a pair goes live (3 h before the start) and done (at the end) with or without one, so
--     "I'm here", the day-of push and A16's morning after reach every pair. The spot
--     suggest/confirm machinery (#17, never rendered since UI pass 1) is removed. The chat's
--     optional "Add a place or time" (set_solo_place) stays; nothing depends on it.
--
-- Who can see the "Open to 1-on-1 here" list does NOT change: can_see_solo, as before.

-- ---------------------------------------------------------------------------
-- 1. No place required
-- ---------------------------------------------------------------------------

drop trigger pins_solo_needs_spots on public.pins;
drop function private.pins_solo_needs_spots();

-- A 1-on-1 may be live or done with no spot.
alter table public.crews drop constraint crews_solo_has_spot;

drop function public.confirm_solo_spot(uuid);
drop function public.suggest_solo_spot(uuid, uuid, timestamptz);
drop function private.my_open_pair(uuid);
drop table public.solo_spot_suggestions;

-- The day-of push for a 1-on-1 with no place says it is on, not where.
create or replace function private.day_of_part(p_crew uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
           when c.kind = 'solo' and s.name is null then 'your 1-on-1 is on'
           else case when c.kind = 'solo' then 'your 1-on-1 meets ' else 'your group meets ' end
             || case when s.name is null then 'at the start'
                     else 'at ' || s.name || ' at ' || to_char(c.meet_at at time zone private.gathering_tz(c.gathering_id), 'FMHH12:MI am') end
         end
  from public.crews c left join public.meeting_spots s on s.id = c.spot_id
  where c.id = p_crew;
$$;
revoke all on function private.day_of_part(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. The pair's one chat
-- ---------------------------------------------------------------------------

alter table public.connections add column a_seen_at timestamptz, add column b_seen_at timestamptz;

create table public.connection_messages (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references public.connections (id) on delete cascade,
  author_id      uuid not null references public.people (id) on delete cascade,
  body           text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index connection_messages_connection_at_idx on public.connection_messages (connection_id, created_at);
alter table public.connection_messages enable row level security;
revoke all on public.connection_messages from public, anon, authenticated;
grant select, delete on public.connection_messages to authenticated;
grant insert (connection_id, author_id, body) on public.connection_messages to authenticated;
comment on table public.connection_messages is
  'A connected pair''s one chat (A20/A29, 16 Nov 2026). Read and written only by its two, while neither blocked the other and neither is hidden. Goes with the connection.';

-- Am I one of this connection's two, and is it live for me: the other not hidden, no block.
create function private.in_connection(p_connection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.connections c
    join public.people o on o.id = case when c.person_a = private.me() then c.person_b else c.person_a end
    where c.id = p_connection
      and private.me() in (c.person_a, c.person_b)
      and o.hidden_at is null
      and not private.blocked_between(c.person_a, c.person_b)
  );
$$;
revoke all on function private.in_connection(uuid) from public;
grant execute on function private.in_connection(uuid) to authenticated;

create policy connection_messages_read_pair on public.connection_messages
  for select to authenticated using (private.in_connection(connection_id));
create policy connection_messages_post_pair on public.connection_messages
  for insert to authenticated with check (
    author_id = private.me() and private.author_shown(author_id) and private.in_connection(connection_id)
  );
create policy connection_messages_delete_own on public.connection_messages
  for delete to authenticated using (author_id = private.me());

-- As the room and the squads: one message every 3 seconds, 200 a day; the server's clock.
create function private.connection_messages_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.connection_messages m
    where m.author_id = new.author_id and m.created_at > now() - interval '3 seconds'
  ) then
    raise exception 'slow down: one message every 3 seconds' using errcode = '23514';
  end if;
  if (select count(*) from public.connection_messages m
      where m.author_id = new.author_id and m.created_at > now() - interval '24 hours') >= 200 then
    raise exception 'that is 200 messages today' using errcode = '23514';
  end if;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function private.connection_messages_limits() from public;
create trigger connection_messages_limits before insert on public.connection_messages
  for each row execute function private.connection_messages_limits();

alter publication supabase_realtime add table public.connection_messages;

-- The connection between two people, if any.
create function private.pair_connection(p_a uuid, p_b uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.connections c where c.person_a = least(p_a, p_b) and c.person_b = greatest(p_a, p_b);
$$;
revoke all on function private.pair_connection(uuid, uuid) from public;

-- My chat with this person: their connection's id, when it is live for me; null otherwise.
create function public.connection_with(p_other uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.connections c
  where c.id = private.pair_connection(private.me(), p_other) and private.in_connection(c.id);
$$;
revoke all on function public.connection_with(uuid) from public, anon;
grant execute on function public.connection_with(uuid) to authenticated;

-- The chat's other person, as the chat screen needs them (only when the chat is mine).
create function public.connection_chat(p_connection uuid) returns table (
  connection_id uuid, person_id uuid, first_name text, photo_path text, since timestamptz, my_seen_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select c.id, o.id, o.first_name,
         case when o.photo_path is not null and private.can_see_photo(o.photo_path) then o.photo_path end,
         c.created_at,
         case when c.person_a = private.me() then c.a_seen_at else c.b_seen_at end
  from public.connections c
  join public.people o on o.id = case when c.person_a = private.me() then c.person_b else c.person_a end
  where c.id = p_connection and private.in_connection(c.id);
$$;
revoke all on function public.connection_chat(uuid) from public, anon;
grant execute on function public.connection_chat(uuid) to authenticated;

create function public.connection_seen(p_connection uuid) returns void
language sql security definer set search_path = '' as $$
  update public.connections set
    a_seen_at = case when person_a = private.me() then now() else a_seen_at end,
    b_seen_at = case when person_b = private.me() then now() else b_seen_at end
  where id = p_connection and private.in_connection(id);
$$;
revoke all on function public.connection_seen(uuid) from public, anon;
grant execute on function public.connection_seen(uuid) to authenticated;

create function private.my_seen_in_connection(p_connection uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case when c.person_a = private.me() then coalesce(c.a_seen_at, c.created_at) else coalesce(c.b_seen_at, c.created_at) end
  from public.connections c where c.id = p_connection and private.me() in (c.person_a, c.person_b);
$$;
revoke all on function private.my_seen_in_connection(uuid) from public;
grant execute on function private.my_seen_in_connection(uuid) to authenticated;

-- A20: my connections, each with its chat's last line and what I haven't read.
drop function public.my_connections();
create function public.my_connections()
returns table (
  person_id uuid, first_name text, photo_path text, met_at text, gathering_id uuid, since timestamptz,
  connection_id uuid, one_on_one boolean, neighbourhood text, last jsonb, unread integer
)
language sql stable security definer set search_path = '' as $$
  select pe.id, pe.first_name,
         case when pe.photo_status <> 'rejected' then pe.photo_path end,
         coalesce(g.name, g2.name), coalesce(g.id, g2.id), c.created_at,
         c.id, coalesce(cr.kind = 'solo', false), pe.neighbourhood,
         (select jsonb_build_object('body', m.body, 'at', m.created_at, 'mine', m.author_id = private.me())
          from public.connection_messages m where m.connection_id = c.id order by m.created_at desc limit 1),
         (select count(*)::integer from (
            select 1 from public.connection_messages m
            where m.connection_id = c.id and m.author_id <> private.me()
              and m.created_at > coalesce(case when c.person_a = private.me() then c.a_seen_at else c.b_seen_at end, c.created_at)
            limit 100) u)
  from public.connections c
  join public.people pe on pe.id = case when c.person_a = private.me() then c.person_b else c.person_a end
  left join public.crews cr on cr.id = c.source_crew_id
  left join public.gatherings g on g.id = cr.gathering_id
  left join public.gatherings g2 on g2.id = c.source_gathering_id
  where private.me() in (c.person_a, c.person_b)
    and pe.hidden_at is null
    and not private.blocked_between(private.me(), pe.id)
  order by coalesce((select max(m.created_at) from public.connection_messages m where m.connection_id = c.id), c.created_at) desc;
$$;
revoke all on function public.my_connections() from public, anon;
grant execute on function public.my_connections() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ending it: silently, for both
-- ---------------------------------------------------------------------------

-- Call off a 1-on-1 that is still on: it ends, both are released, and the pair's connection
-- (and chat) goes. Nobody is told. A no-op for one that is done, dissolved or not a 1-on-1.
create function private.call_off_solo(p_crew uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_people uuid[];
begin
  update public.crews set state = 'dissolved', dissolved_at = now()
  where id = p_crew and kind = 'solo' and state in ('forming', 'spot_set', 'live');
  if not found then
    return;
  end if;
  select array_agg(m.person_id) into v_people from public.crew_members m where m.crew_id = p_crew;
  update public.crew_members set left_at = now() where crew_id = p_crew and left_at is null;
  if coalesce(array_length(v_people, 1), 0) = 2 then
    delete from public.connections where id = private.pair_connection(v_people[1], v_people[2]);
  end if;
end;
$$;
revoke all on function private.call_off_solo(uuid) from public;

-- Either leaves ("Call off", or a block, which leaves every group): silent now (Alex, 16 Nov).
-- H9's hides and the brake still go through dissolve_solo, which tells both, and they keep
-- the connection: a moderation stop is not either person's choice to part.
create or replace function private.solo_member_left() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'solo' and old.left_at is null and new.left_at is not null then
    perform private.call_off_solo(new.crew_id);
  end if;
  return new;
end;
$$;
revoke all on function private.solo_member_left() from public;

-- Leave the 1-on-1s still on between me and them (which calls them off, as above).
create function private.leave_shared_solo(p_me uuid, p_other uuid) returns void
language sql security definer set search_path = '' as $$
  update public.crew_members m set left_at = now()
  from public.crews c
  where c.id = m.crew_id and c.kind = 'solo' and c.state in ('forming', 'spot_set', 'live')
    and m.person_id = p_me and m.left_at is null
    and exists (select 1 from public.crew_members o where o.crew_id = c.id and o.person_id = p_other and o.left_at is null);
$$;
revoke all on function private.leave_shared_solo(uuid, uuid) from public;

create function public.remove_connection(p_other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  perform private.leave_shared_solo(v_me, p_other);
  delete from public.connections where id = private.pair_connection(v_me, p_other);
end;
$$;
revoke all on function public.remove_connection(uuid) from public, anon;
grant execute on function public.remove_connection(uuid) to authenticated;

-- A block ends the connection too (blocks_blocker_leaves_group already calls off the 1-on-1).
create function private.blocks_end_connection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.leave_shared_solo(new.blocker_id, new.blocked_id);
  delete from public.connections where id = private.pair_connection(new.blocker_id, new.blocked_id);
  return null;
end;
$$;
revoke all on function private.blocks_end_connection() from public;
create trigger blocks_end_connection after insert on public.blocks
  for each row execute function private.blocks_end_connection();

-- So does a report, on the person reported (directly, or as a message's author).
create function private.reports_end_connection() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_person uuid := coalesce(
    new.target_person_id,
    (select m.author_id from public.crew_messages m where m.id = new.target_message_id),
    (select m.author_id from public.room_messages m where m.id = new.target_room_message_id)
  );
begin
  if new.reporter_id is not null and v_person is not null and v_person <> new.reporter_id then
    perform private.leave_shared_solo(new.reporter_id, v_person);
    delete from public.connections where id = private.pair_connection(new.reporter_id, v_person);
  end if;
  return null;
end;
$$;
revoke all on function private.reports_end_connection() from public;
create trigger reports_end_connection after insert on public.reports
  for each row execute function private.reports_end_connection();

-- ---------------------------------------------------------------------------
-- 4. Requests until the effective end; an accept makes the connection
-- ---------------------------------------------------------------------------

create or replace function public.propose_solo(p_gathering uuid, p_to uuid, p_spot uuid, p_meet_at timestamptz, p_line smallint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'refused: no person' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('solo_proposals:' || v_me::text || ':' || p_gathering::text));
  if exists (select 1 from public.gatherings g where g.id = p_gathering and now() >= public.effective_end(g)) then
    raise exception 'refused: requests closed at the end' using errcode = '42501';
  end if;
  if not private.can_see_solo(p_to, p_gathering) then
    raise exception 'refused: not available for 1-on-1' using errcode = '42501';
  end if;
  -- Build 23 sends neither; an older build may still send both, checked as before.
  if (p_spot is null) <> (p_meet_at is null) then
    raise exception 'refused: a spot and a time together, or neither' using errcode = '22023';
  end if;
  if p_spot is not null then
    if not exists (
      select 1 from public.gatherings g join public.meeting_spots s on s.venue_id = g.venue_id
      where g.id = p_gathering and s.id = p_spot and s.active
    ) then
      raise exception 'refused: not one of this venue''s spots' using errcode = '22023';
    end if;
    if not private.solo_time_ok(p_gathering, p_meet_at) then
      raise exception 'refused: not one of the times on offer' using errcode = '22023';
    end if;
  end if;
  if p_line is not null and p_line not between 1 and 5 then
    raise exception 'refused: not one of the five lines' using errcode = '22023';
  end if;
  if (select count(*) from public.solo_proposals p
      where p.from_person = v_me and p.gathering_id = p_gathering and private.solo_pending(p.status)) >= 3 then
    raise exception 'refused: three open' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.solo_proposals p
    where p.gathering_id = p_gathering
      and least(p.from_person, p.to_person) = least(v_me, p_to)
      and greatest(p.from_person, p.to_person) = greatest(v_me, p_to)
  ) then
    raise exception 'refused: already asked' using errcode = '42501';
  end if;
  begin
    insert into public.solo_proposals (gathering_id, from_person, to_person, spot_id, meet_at, line)
    values (p_gathering, v_me, p_to, p_spot, p_meet_at, p_line)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'refused: already asked' using errcode = '42501';
  end;
  return v_id;
end;
$$;

create or replace function public.respond_to_solo(p_proposal uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.solo_proposals;
  v_from uuid;
  v_crew uuid;
begin
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
  if exists (select 1 from public.gatherings g where g.id = v_p.gathering_id and now() >= public.effective_end(g))
     or not private.can_see_solo(v_p.from_person, v_p.gathering_id)
     or (v_p.spot_id is not null and not exists (select 1 from public.meeting_spots s where s.id = v_p.spot_id and s.active)) then
    update public.solo_proposals set status = 'closed', decided_at = now() where id = p_proposal;
    raise exception 'refused: that proposal is no longer open' using errcode = '42501';
  end if;
  begin
    insert into public.crews (gathering_id, kind, state, spot_id, meet_at)
    values (v_p.gathering_id, 'solo', case when v_p.spot_id is null then 'forming' else 'spot_set' end::public.crew_state, v_p.spot_id, v_p.meet_at)
    returning id into v_crew;
    insert into public.crew_members (crew_id, gathering_id, person_id, kind)
    values (v_crew, v_p.gathering_id, v_p.from_person, 'solo'), (v_crew, v_p.gathering_id, v_p.to_person, 'solo');
  exception when unique_violation then
    raise exception 'refused: that proposal is no longer open' using errcode = '42501';
  end;
  -- Connections from the yes (Alex, 16 Nov 2026). Already connected: the connection stands.
  insert into public.connections (person_a, person_b, source_crew_id)
  values (least(v_p.from_person, v_p.to_person), greatest(v_p.from_person, v_p.to_person), v_crew)
  on conflict (person_a, person_b) do nothing;
  update public.solo_proposals set status = 'accepted', decided_at = now(), crew_id = v_crew where id = p_proposal;
  perform private.close_solo_proposals(v_p.gathering_id, v_p.from_person);
  perform private.close_solo_proposals(v_p.gathering_id, v_p.to_person);
  return v_crew;
end;
$$;

create or replace function public.my_solo_requests() returns table (
  proposal_id uuid, gathering_id uuid, gathering_name text, gathering_slug text, starts_at timestamptz,
  person_id uuid, first_name text, photo_path text, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select p.id, g.id, g.name, g.slug, g.starts_at, o.id, o.first_name,
         case when o.photo_path is not null and private.can_see_photo(o.photo_path) then o.photo_path end, p.created_at
  from public.solo_proposals p
  join public.gatherings g on g.id = p.gathering_id
  join public.people o on o.id = p.from_person
  where p.to_person = private.me() and p.status = 'open' and now() < public.effective_end(g)
    and not private.blocked_between(p.from_person, p.to_person)
    and private.can_see_solo(p.from_person, p.gathering_id)
  order by p.created_at;
$$;

create or replace function public.my_solo_proposals(p_gathering uuid)
returns table (proposal_id uuid, direction text, person_id uuid, first_name text, spot_id uuid, spot_name text, meet_at timestamptz, line smallint, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, case when p.to_person = private.me() then 'received' else 'sent' end,
         o.id, o.first_name, s.id, s.name, p.meet_at, p.line, p.created_at
  from public.solo_proposals p
  join public.gatherings g on g.id = p.gathering_id
  left join public.meeting_spots s on s.id = p.spot_id
  join public.people o on o.id = case when p.to_person = private.me() then p.from_person else p.to_person end
  where p.gathering_id = p_gathering
    and now() < public.effective_end(g)
    and not private.blocked_between(p.from_person, p.to_person)
    and (
      (p.to_person = private.me() and p.status = 'open' and private.can_see_solo(p.from_person, p.gathering_id))
      or (p.from_person = private.me() and private.solo_pending(p.status))
    )
  order by p.created_at;
$$;

create or replace function private.people_solo_follows_hide() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if (new.hidden_at is not null and old.hidden_at is null)
     or (new.hidden_from_solo and not old.hidden_from_solo) then
    update public.solo_proposals p set status = 'closed', decided_at = coalesce(p.decided_at, now())
    from public.gatherings g
    where g.id = p.gathering_id and now() < public.effective_end(g)
      and private.solo_pending(p.status) and new.id in (p.from_person, p.to_person);
  end if;
  if new.hidden_at is not null and old.hidden_at is null then
    for r in
      select m.crew_id from public.crew_members m join public.crews c on c.id = m.crew_id
      where m.person_id = new.id and m.kind = 'solo' and m.left_at is null and c.state in ('forming', 'spot_set', 'live')
    loop
      perform private.dissolve_solo(r.crew_id, true);
    end loop;
  end if;
  return new;
end;
$$;

-- The export, without the removed spot suggestions; your chats' messages are yours too.
create or replace function public.my_solo_export() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', coalesce((
      select jsonb_agg(jsonb_build_object('gathering_id', p.gathering_id, 'meet_1_on_1', p.solo_opt_in, 'who_can_see_you', p.solo_visibility))
      from public.pins p where p.person_id = private.me() and p.solo_opt_in
    ), '[]'::jsonb),
    'proposals_sent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gathering_id', p.gathering_id, 'spot', s.name, 'meet_at', p.meet_at, 'line', p.line, 'sent_at', p.created_at,
        'status', case
          when p.status in ('accepted', 'withdrawn', 'closed') then p.status::text
          when now() < public.effective_end(g) then 'sent'
          else 'not accepted' end))
      from public.solo_proposals p
      join public.gatherings g on g.id = p.gathering_id
      left join public.meeting_spots s on s.id = p.spot_id
      where p.from_person = private.me()
    ), '[]'::jsonb),
    'proposals_received', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gathering_id', p.gathering_id, 'spot', s.name, 'meet_at', p.meet_at, 'line', p.line, 'received_at', p.created_at,
        'status', case when p.declined_by_recipient then 'declined' else p.status::text end, 'answered_at', p.decided_at))
      from public.solo_proposals p
      left join public.meeting_spots s on s.id = p.spot_id
      where p.to_person = private.me()
    ), '[]'::jsonb),
    'chat_messages_written', coalesce((
      select jsonb_agg(jsonb_build_object('body', m.body, 'at', m.created_at) order by m.created_at)
      from public.connection_messages m where m.author_id = private.me()
    ), '[]'::jsonb)
  );
$$;

-- #3 on accept: a pair says to say hi (no spot to pick).
create or replace function private.notify_solo_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := private.gathering_tz(new.gathering_id);
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (person_id, kind, gathering_id, solo_proposal_id, title, body, path)
    select new.to_person, 'solo_proposal', new.gathering_id, new.id, private.gathering_name(new.gathering_id),
           -- PROPOSED copy (Tatiana's to reword).
           f.first_name || ' wants to chat 1-on-1 at ' || private.gathering_name(new.gathering_id),
           private.crowd_path(new.gathering_id)
    from public.people f, public.people t
    where f.id = new.from_person and t.id = new.to_person
      and t.hidden_at is null
      and not private.blocked_between(new.from_person, new.to_person)
      and private.wants(new.to_person, 'solo_proposal');
  elsif new.status = 'accepted' and old.status = 'open' and new.spot_id is null then
    insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
    select new.from_person, 'plan_status', new.gathering_id, new.crew_id, private.gathering_name(new.gathering_id),
           -- PROPOSED copy (Tatiana's to reword).
           t.first_name || ' said yes. Say hi.',
           '/group/' || new.crew_id
    from public.people t, public.people f
    where t.id = new.to_person and f.id = new.from_person
      and f.hidden_at is null
      and private.wants(new.from_person, 'plan_status');
  elsif new.status = 'accepted' and old.status = 'open' then
    insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
    select new.from_person, 'plan_status', new.gathering_id, new.crew_id, private.gathering_name(new.gathering_id),
           -- PROPOSED copy (Tatiana's to reword).
           t.first_name || ' said yes: you''re meeting at ' || s.name || ', '
             || to_char(new.meet_at at time zone v_tz, 'FMHH12:MI am') || '.',
           '/group/' || new.crew_id
    from public.people t, public.people f, public.meeting_spots s
    where t.id = new.to_person and f.id = new.from_person and s.id = new.spot_id
      and f.hidden_at is null
      and private.wants(new.from_person, 'plan_status');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The lifecycle: requests lapse at the end; a pair goes live and done with no place
-- ---------------------------------------------------------------------------

create or replace function public.admin_groups_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expired int; v_dissolved int; v_planned int; v_live int; v_done int; v_solo_expired int; v_solo_closed int;
begin
  update public.crew_invites i set status = 'expired', decided_at = now()
  from public.gatherings g
  where g.id = i.gathering_id and i.status = 'sent' and now() >= g.starts_at;
  get diagnostics v_expired = row_count;

  -- 1-on-1 requests lapse at the effective end (16 Nov 2026; was the start); a withdrawn gathering's close.
  update public.solo_proposals p set status = 'expired', decided_at = now()
  from public.gatherings g
  where g.id = p.gathering_id and p.status in ('open', 'declined') and now() >= public.effective_end(g);
  get diagnostics v_solo_expired = row_count;
  update public.solo_proposals p set status = 'closed', decided_at = coalesce(p.decided_at, now())
  from public.gatherings g
  where g.id = p.gathering_id and private.solo_pending(p.status) and g.withdrawn_at is not null;
  get diagnostics v_solo_closed = row_count;

  update public.crews c set state = 'dissolved', dissolved_at = now()
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'forming' and c.kind = 'crew'
    and now() >= least(greatest(g.starts_at - interval '6 hours', c.created_at + interval '2 hours'), g.starts_at - interval '3 hours')
    and private.active_members(c.id) < 3;
  get diagnostics v_dissolved = row_count;
  update public.crew_members m set left_at = now()
  from public.crews c
  where c.id = m.crew_id and c.state = 'dissolved' and m.left_at is null;
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
  where g.id = c.gathering_id and c.state = 'forming' and c.kind = 'crew'
    and now() >= g.starts_at - interval '3 hours'
    and private.active_members(c.id) >= 3;
  get diagnostics v_planned = row_count;

  -- A plan, or a 1-on-1 with or without a place, goes live 3 h before the start.
  update public.crews c set state = 'live'
  from public.gatherings g
  where g.id = c.gathering_id
    and (c.state = 'spot_set' or (c.kind = 'solo' and c.state = 'forming'))
    and now() >= g.starts_at - interval '3 hours';
  get diagnostics v_live = row_count;

  update public.crews c set state = 'done'
  from public.gatherings g
  where g.id = c.gathering_id
    and (c.state in ('spot_set', 'live') or (c.kind = 'solo' and c.state = 'forming'))
    and now() >= case when c.kind = 'solo' or not c.legacy
                      then greatest(public.effective_end(g), c.meet_at + interval '1 hour')
                      else public.effective_end(g) end;
  get diagnostics v_done = row_count;

  return jsonb_build_object('expired', v_expired, 'dissolved', v_dissolved, 'planned', v_planned, 'live', v_live, 'done', v_done,
                            'solo_expired', v_solo_expired, 'solo_closed', v_solo_closed);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. A19: a 1-on-1's row reads the pair's chat
-- ---------------------------------------------------------------------------

-- The connection behind my 1-on-1 here: between me and its other person.
create function private.my_solo_connection(p_crew uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select private.pair_connection(private.me(), o.person_id)
  from public.crew_members o join public.crews c on c.id = o.crew_id
  where o.crew_id = p_crew and c.kind = 'solo' and o.person_id <> private.me()
    and private.in_crew(private.me(), p_crew)
  limit 1;
$$;
revoke all on function private.my_solo_connection(uuid) from public;
grant execute on function private.my_solo_connection(uuid) to authenticated;

create or replace function public.my_chats() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with me as (
    select private.me() as id
  ),
  ev as (
    select p.gathering_id, p.open_to_meeting, g.slug, g.name, g.starts_at, g.ends_at, g.withdrawn_at,
           public.effective_end(g) as ends_eff, v.name as venue, c.timezone,
           now() >= public.effective_end(g) as past,
           now() < public.effective_end(g) + interval '24 hours' + interval '30 days' as chats_kept
    from public.pins p
    join public.gatherings g on g.id = p.gathering_id
    left join public.venues v on v.id = g.venue_id
    left join public.cities c on c.slug = v.city
    where p.person_id = (select id from me) and g.slug is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'gathering_id', ev.gathering_id,
    'slug', ev.slug,
    'name', ev.name,
    'venue', ev.venue,
    'timezone', ev.timezone,
    'starts_at', ev.starts_at,
    'ends_at', ev.ends_at,
    'ends_eff', ev.ends_eff,
    'withdrawn', ev.withdrawn_at is not null,
    'open_to_meeting', ev.open_to_meeting,
    'after', case when ev.past then public.after_state(ev.gathering_id) end,
    'rooms', case when ev.chats_kept then coalesce((
      select jsonb_agg(jsonb_build_object(
        'room_id', r.room_id, 'number', r.number, 'women_only', r.women_only, 'members', r.members, 'open', r.open,
        'last', (
          select jsonb_build_object('body', m.body, 'at', m.created_at, 'author_id', m.author_id,
                                    'mine', m.author_id = (select id from me),
                                    'author', (select pe.first_name from public.people pe where pe.id = m.author_id))
          from public.room_messages m where m.room_id = r.room_id order by m.created_at desc limit 1
        ),
        'unread', (
          select count(*) from (
            select 1 from public.room_messages m
            where m.room_id = r.room_id
              and m.created_at > (select coalesce(private.my_seen_in_room(r.room_id), '-infinity'::timestamptz))
              and m.author_id <> (select id from me)
            limit 100
          ) u
        )
      ) order by r.women_only)
      from public.my_rooms(ev.gathering_id) r
    ), '[]'::jsonb) else '[]'::jsonb end,
    'crews', case when ev.chats_kept then coalesce((
      select jsonb_agg(jsonb_build_object(
        'crew_id', cr.id, 'kind', cr.kind, 'name', cr.name, 'legacy', cr.legacy, 'state', cr.state,
        'meet_at', cr.meet_at,
        'spot', (select sp.name from public.meeting_spots sp where sp.id = cr.spot_id),
        'partner', case when cr.kind = 'solo' then (
          select pe.first_name from public.crew_members o join public.people pe on pe.id = o.person_id
          where o.crew_id = cr.id and o.person_id <> (select id from me) limit 1
        ) end,
        -- A 1-on-1's chat is the pair's connection chat (16 Nov 2026).
        'connection_id', case when cr.kind = 'solo' then private.my_solo_connection(cr.id) end,
        'members', (select coalesce(sum(o.seats), 0) from public.crew_members o where o.crew_id = cr.id and o.left_at is null),
        'faces', coalesce((
          select jsonb_agg(jsonb_build_object('person_id', f.id, 'first_name', f.first_name, 'photo_path', f.photo_path) order by f.joined_at)
          from (
            select pe.id, pe.first_name, pe.photo_path, o.joined_at
            from public.crew_members o join public.people pe on pe.id = o.person_id
            where o.crew_id = cr.id and o.left_at is null and o.person_id <> (select id from me)
            order by o.joined_at limit 3
          ) f
        ), '[]'::jsonb),
        'last', case when cr.kind = 'solo' then (
          select jsonb_build_object('body', m.body, 'at', m.created_at, 'author_id', m.author_id,
                                    'mine', m.author_id = (select id from me),
                                    'author', (select pe.first_name from public.people pe where pe.id = m.author_id))
          from public.connection_messages m where m.connection_id = private.my_solo_connection(cr.id)
          order by m.created_at desc limit 1
        ) else (
          select jsonb_build_object('body', m.body, 'at', m.created_at, 'author_id', m.author_id,
                                    'mine', m.author_id = (select id from me),
                                    'author', (select pe.first_name from public.people pe where pe.id = m.author_id))
          from public.crew_messages m where m.crew_id = cr.id and m.kind = 'user' order by m.created_at desc limit 1
        ) end,
        'unread', case when cr.kind = 'solo' then (
          select count(*) from (
            select 1 from public.connection_messages m
            where m.connection_id = private.my_solo_connection(cr.id)
              and m.created_at > (select coalesce(private.my_seen_in_connection(private.my_solo_connection(cr.id)), '-infinity'::timestamptz))
              and m.author_id <> (select id from me)
            limit 100
          ) u
        ) else (
          select count(*) from (
            select 1 from public.crew_messages m
            where m.crew_id = cr.id
              and m.created_at > (select coalesce(private.my_seen_in_crew(cr.id), '-infinity'::timestamptz))
              and m.kind = 'user' and m.author_id is distinct from (select id from me)
            limit 100
          ) u
        ) end
      ) order by cr.kind)
      from public.crew_members cm join public.crews cr on cr.id = cm.crew_id
      where cm.person_id = (select id from me) and cm.gathering_id = ev.gathering_id and cm.left_at is null
        and cr.state <> 'dissolved'
    ), '[]'::jsonb) else '[]'::jsonb end,
    'open_squads', case when not ev.past and ev.withdrawn_at is null then coalesce((
      select jsonb_agg(jsonb_build_object(
        'crew_id', s.crew_id, 'name', s.name, 'women_only', s.women_only, 'spot', s.spot,
        'meet_at', s.meet_at, 'seats', s.seats, 'full', s.is_full
      ) order by s.is_full, s.meet_at)
      from public.squads(ev.gathering_id) s
      where not exists (
        select 1 from public.crew_members cm
        where cm.crew_id = s.crew_id and cm.person_id = (select id from me) and cm.left_at is null
      )
    ), '[]'::jsonb) else '[]'::jsonb end
  ) order by ev.starts_at), '[]'::jsonb)
  from ev;
$$;
