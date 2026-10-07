-- M3.3 — the night and after (Alex, 29 Sept 2026: "1, 2, 3 and 4: approved as written";
-- a, b and c answered the same day). Spec A13/A16/A17/A20/A18, build plan §8 M3.3.
--
--   1  A16 — "we met", then "keep in touch". Per person you tick, in a group of 3+ that
--      reached the end of its gathering, for 7 days after the effective end:
--        nothing → "we met" → matched → "keep in touch" → matched → a connection.
--      A tick can be taken back until it is matched; a match cannot. "Keep in touch" only
--      once the "we met" is matched. You see only your own ticks; nobody ever learns of a
--      tick they did not match (Q6) — `after_state` computes "matched" only from a tick of
--      yours. A matched "we met" is the "showed up" badge.
--   2  Connections (V23): the two people see each other's first name, photo and where
--      they met — and the handle, which V17 already allowed — outside any gathering. A
--      block either way hides it from both. So do the group's members, for A16's 7 days.
--      Both are one function, `after_peer`, added to `can_see` so the people row, the
--      photo and a report follow the same rule.
--   3  The after-event question: everyone who was open to meeting at the gathering,
--      group or not, once, after the end. Readable by its author (and the admin's
--      counts). Test 0's "did you meet" is no longer asked: the group state knows.
--   4  #4 day-of, when a group goes live (3 h before), to its members, once; #5 next
--      morning, 9am local, to everyone who was open to meeting — "Did you meet up?" to
--      a finished group, only the question, gently, to everyone else (Alex, a).
--   b  "Women-only rooms only" (Alex): a real only. If set, you are placed in the
--      women-only room and never the general one; until it has 3 you are in no room,
--      A9 says so without a number (H7's "never a number" — see the note below), and
--      one tap joins the general room for that gathering.
--   c  Invite (#7, Alex): only between connected people, only to a gathering the
--      inviter is pinned to, one per pair per gathering, five a day per inviter; "Maya's
--      going to X — want to come?", with the crowd link. Off in one tap.
--
-- The notification wording here is PROPOSED, like room.ts — Tatiana's doc replaces it.
--
-- The count while waiting for the women-only room is left out on purpose. decisions Q9's
-- "never a number" still applies to any women-only signal: the room holds women and
-- the nonbinary people who opted in, and next to the public mix a count of it tells
-- anyone waiting how many nonbinary people opted in. Raised with Alex, not decided here.

-- ---------------------------------------------------------------------------
-- Who you are after the night (V23)
-- ---------------------------------------------------------------------------

create function private.gathering_tz(p_gathering uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select c.timezone from public.gatherings g
    join public.venues v on v.id = g.venue_id
    join public.cities c on c.slug = v.city
    where g.id = p_gathering
  ), 'America/Toronto');
$$;
revoke all on function private.gathering_tz(uuid) from public;

-- The A16 window: a group that reached the end of its gathering, for 7 days.
create function private.after_open(p_crew uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.crews c join public.gatherings g on g.id = c.gathering_id
    where c.id = p_crew and c.state = 'done' and c.hidden_at is null
      and now() < public.effective_end(g) + interval '7 days'
  );
$$;
revoke all on function private.after_open(uuid) from public;

create function private.in_crew(p_person uuid, p_crew uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crew_members m where m.crew_id = p_crew and m.person_id = p_person and m.left_at is null);
$$;
revoke all on function private.in_crew(uuid, uuid) from public;

create function private.after_peer(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select me.id <> p_target
       and not private.blocked_between(me.id, p_target)
       and exists (
         select 1 from public.people t
         where t.id = p_target and t.hidden_at is null and (not t.is_seed or private.i_am_tester())
       )
       and (
         private.are_connected(p_target)
         or exists (
           select 1 from public.crew_members mine
           join public.crew_members theirs on theirs.crew_id = mine.crew_id
           where mine.person_id = me.id and mine.left_at is null
             and theirs.person_id = p_target and theirs.left_at is null
             and private.after_open(mine.crew_id)
         )
       )
    from (select private.me() as id) me
    where me.id is not null
  ), false);
$$;
revoke all on function private.after_peer(uuid) from public;
grant execute on function private.after_peer(uuid) to authenticated;
comment on function private.after_peer(uuid) is
  'V23 (M3.3): a connection, or a member of a finished group for its 7 days after — never across a block, never a hidden person.';

create or replace function private.can_see(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pins t
    where t.person_id = p_target
      and t.open_to_meeting
      and private.can_see_at(p_target, t.gathering_id)
  ) or private.after_peer(p_target);
$$;

-- ---------------------------------------------------------------------------
-- A16: the ticks (confirmations stay unreadable; these functions are the only door)
-- ---------------------------------------------------------------------------

create function private.ticked(p_crew uuid, p_from uuid, p_to uuid, p_kind public.confirmation_kind) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.confirmations c where c.crew_id = p_crew and c.from_person = p_from and c.to_person = p_to and c.kind = p_kind);
$$;
revoke all on function private.ticked(uuid, uuid, uuid, public.confirmation_kind) from public;

create function public.after_tick(p_crew uuid, p_to uuid, p_kind public.confirmation_kind, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
begin
  if v_me is null or v_me = p_to
     or not private.in_crew(v_me, p_crew) or not private.in_crew(p_to, p_crew)
     or private.blocked_between(v_me, p_to) then
    raise exception 'refused: not in this group' using errcode = '42501';
  end if;
  if not private.after_open(p_crew) then
    raise exception 'refused: after closed' using errcode = '42501';
  end if;
  if p_on then
    if p_kind = 'keep_in_touch'
       and not (private.ticked(p_crew, v_me, p_to, 'we_met') and private.ticked(p_crew, p_to, v_me, 'we_met')) then
      raise exception 'refused: we met first' using errcode = '42501';
    end if;
    insert into public.confirmations (crew_id, from_person, to_person, kind) values (p_crew, v_me, p_to, p_kind)
    on conflict do nothing;
    if p_kind = 'keep_in_touch' and private.ticked(p_crew, p_to, v_me, 'keep_in_touch') then
      insert into public.connections (person_a, person_b, source_crew_id)
      values (least(v_me, p_to), greatest(v_me, p_to), p_crew)
      on conflict do nothing;
    end if;
  else
    -- Take a tick back only while it is unmatched. Taking back "we met" takes the
    -- unmatched "keep in touch" that hung on it too.
    if private.ticked(p_crew, p_to, v_me, p_kind) and private.ticked(p_crew, v_me, p_to, p_kind) then
      raise exception 'refused: matched' using errcode = '42501';
    end if;
    delete from public.confirmations
    where crew_id = p_crew and from_person = v_me and to_person = p_to
      and (kind = p_kind or (p_kind = 'we_met' and kind = 'keep_in_touch'));
  end if;
end;
$$;
revoke all on function public.after_tick(uuid, uuid, public.confirmation_kind, boolean) from public, anon;
grant execute on function public.after_tick(uuid, uuid, public.confirmation_kind, boolean) to authenticated;

-- Everything A16 shows me for one gathering: whether I am asked the question and have
-- answered, and my finished group's people with MY ticks — "matched" only ever computed
-- from a tick of mine, so an unmatched tick of theirs is never visible (Q6).
create function public.after_state(p_gathering uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_crew uuid;
  v_ended boolean;
begin
  if v_me is null then return null; end if;
  select now() >= public.effective_end(g) into v_ended from public.gatherings g where g.id = p_gathering;
  select m.crew_id into v_crew
  from public.crew_members m join public.crews c on c.id = m.crew_id
  where m.person_id = v_me and m.gathering_id = p_gathering and m.left_at is null and c.state = 'done' and c.hidden_at is null
  limit 1;
  return jsonb_build_object(
    'ended', coalesce(v_ended, false),
    'asked', coalesce(v_ended, false) and exists (
      select 1 from public.pins p where p.person_id = v_me and p.gathering_id = p_gathering and p.open_to_meeting),
    'answered', exists (select 1 from public.survey_responses s where s.person_id = v_me and s.gathering_id = p_gathering),
    'crew_id', v_crew,
    'open', v_crew is not null and private.after_open(v_crew),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', pe.id,
        'first_name', pe.first_name,
        'photo_path', case when pe.photo_status <> 'rejected' then pe.photo_path end,
        'we_met', private.ticked(v_crew, v_me, pe.id, 'we_met'),
        'we_met_matched', private.ticked(v_crew, v_me, pe.id, 'we_met') and private.ticked(v_crew, pe.id, v_me, 'we_met'),
        'keep', private.ticked(v_crew, v_me, pe.id, 'keep_in_touch'),
        'keep_matched', private.ticked(v_crew, v_me, pe.id, 'keep_in_touch') and private.ticked(v_crew, pe.id, v_me, 'keep_in_touch')
      ) order by m.joined_at)
      from public.crew_members m join public.people pe on pe.id = m.person_id
      where v_crew is not null and m.crew_id = v_crew and m.left_at is null and m.person_id <> v_me
        and pe.hidden_at is null and not private.blocked_between(v_me, pe.id)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.after_state(uuid) from public, anon;
grant execute on function public.after_state(uuid) to authenticated;

-- The "showed up" badge: at least one matched "we met". Readable for yourself and for
-- anyone you can see.
create function public.showed_up(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_person = private.me() or private.can_see(p_person))
     and exists (
       select 1 from public.confirmations a
       join public.confirmations b on b.crew_id = a.crew_id and b.from_person = a.to_person and b.to_person = a.from_person and b.kind = a.kind
       where a.from_person = p_person and a.kind = 'we_met'
     );
$$;
revoke all on function public.showed_up(uuid) from public, anon;
grant execute on function public.showed_up(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Connections (A20) — through this function only; the table stays unreadable
-- ---------------------------------------------------------------------------

create function public.my_connections()
returns table (person_id uuid, first_name text, photo_path text, met_at text, gathering_id uuid, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select pe.id, pe.first_name,
         case when pe.photo_status <> 'rejected' then pe.photo_path end,
         g.name, g.id, c.created_at
  from public.connections c
  join public.people pe on pe.id = case when c.person_a = private.me() then c.person_b else c.person_a end
  left join public.crews cr on cr.id = c.source_crew_id
  left join public.gatherings g on g.id = cr.gathering_id
  where private.me() in (c.person_a, c.person_b)
    and pe.hidden_at is null
    and not private.blocked_between(private.me(), pe.id)
  order by c.created_at desc;
$$;
revoke all on function public.my_connections() from public, anon;
grant execute on function public.my_connections() to authenticated;

-- ---------------------------------------------------------------------------
-- 3: the after-event question
-- ---------------------------------------------------------------------------

alter table public.survey_responses alter column met drop not null;

drop policy survey_responses_insert_own on public.survey_responses;
create policy survey_responses_insert_own on public.survey_responses
  for insert to authenticated
  with check (
    person_id = private.me()
    and exists (
      select 1 from public.pins p join public.gatherings g on g.id = p.gathering_id
      where p.person_id = private.me() and p.gathering_id = survey_responses.gathering_id
        and p.open_to_meeting and now() >= public.effective_end(g)
    )
  );

-- ---------------------------------------------------------------------------
-- b: "women-only rooms only"
-- ---------------------------------------------------------------------------

alter table public.people_private add column women_only_rooms boolean not null default false;
comment on column public.people_private.women_only_rooms is
  'Placed only in the women-only room, never the general one (Alex, 29 Sept). Honoured only while eligible; set through set_women_only_rooms.';

create function private.women_only_rooms_only(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_women_only_eligible(p_person)
     and coalesce((select pp.women_only_rooms from public.people_private pp where pp.person_id = p_person), false);
$$;
revoke all on function private.women_only_rooms_only(uuid) from public;

create or replace function private.pins_place_in_rooms() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.leave_rooms(old.person_id, old.gathering_id);
    return old;
  end if;
  if new.open_to_meeting and (tg_op = 'INSERT' or not old.open_to_meeting) then
    if not private.women_only_rooms_only(new.person_id) then
      perform private.place_in_room(new.person_id, new.gathering_id, false);
    end if;
    if private.is_women_only_eligible(new.person_id) then
      perform private.place_in_room(new.person_id, new.gathering_id, true);
    end if;
  elsif tg_op = 'UPDATE' and old.open_to_meeting and not new.open_to_meeting then
    perform private.leave_rooms(new.person_id, new.gathering_id);
  end if;
  return new;
end;
$$;

-- The switch, with its consequence at every gathering still to come: on leaves the
-- general rooms (your messages stay), off places you back in them.
create function public.set_women_only_rooms(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  r record;
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  if p_on and not private.is_women_only_eligible(v_me) then
    raise exception 'refused: not eligible' using errcode = '42501';
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
revoke all on function public.set_women_only_rooms(boolean) from public, anon;
grant execute on function public.set_women_only_rooms(boolean) to authenticated;

-- One tap on A9 while waiting: the general room, for this gathering only.
create function public.join_general_room(p_gathering uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if v_me is null or not exists (
    select 1 from public.pins p where p.person_id = v_me and p.gathering_id = p_gathering and p.open_to_meeting
  ) then
    raise exception 'refused: not open to meeting here' using errcode = '42501';
  end if;
  perform private.place_in_room(v_me, p_gathering, false);
end;
$$;
revoke all on function public.join_general_room(uuid) from public, anon;
grant execute on function public.join_general_room(uuid) to authenticated;

-- Am I waiting for the women-only room here? True or false — never how many.
create function public.waiting_for_women_only_room(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members m
    where m.person_id = private.me() and m.gathering_id = p_gathering and m.women_only and m.left_at is null
      and (select count(*) from public.room_members o where o.room_id = m.room_id and o.left_at is null) < 3
  ) and not exists (
    select 1 from public.room_members g
    where g.person_id = private.me() and g.gathering_id = p_gathering and not g.women_only and g.left_at is null
  );
$$;
revoke all on function public.waiting_for_women_only_room(uuid) from public, anon;
grant execute on function public.waiting_for_women_only_room(uuid) to authenticated;

-- #2 for the women-only room fires when it opens, at 3 — not at 2, when it is not yet
-- offered. (Before this, a woman in both rooms could be told at 2 about a room she
-- could not see; the once-per-gathering index usually hid it behind the general one.)
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

-- ---------------------------------------------------------------------------
-- The switches: the seventh, "invites from people you've met"
-- ---------------------------------------------------------------------------

alter table public.notification_settings add column invites boolean not null default true;
grant update (invites) on public.notification_settings to authenticated;

create or replace function private.wants(p_person uuid, p_kind public.notification_kind) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_kind
      when 'digest' then s.digest when 'room_open' then s.room_open when 'plan_status' then s.plan_status
      when 'day_of' then s.day_of when 'next_morning' then s.next_morning when 'room_activity' then s.room_activity
      when 'invite' then s.invites end
    from public.notification_settings s where s.person_id = p_person
  ), true);
$$;

-- ---------------------------------------------------------------------------
-- 4: #4 day-of, when a group goes live
-- ---------------------------------------------------------------------------

create unique index notifications_day_of_once on public.notifications (person_id, crew_id) where kind = 'day_of';
create unique index notifications_next_morning_once on public.notifications (person_id, gathering_id) where kind = 'next_morning';

create or replace function private.notify_group_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_body text;
  v_spot text;
  v_kind public.notification_kind := 'plan_status';
  v_path text := private.crowd_path(new.gathering_id);
  v_tz text := private.gathering_tz(new.gathering_id);
  v_when text;
begin
  if new.state = old.state then
    return new;
  end if;
  select s.name into v_spot from public.meeting_spots s where s.id = new.spot_id;
  if new.state = 'dissolved' then
    v_body := 'Not enough people joined your group for ' || private.gathering_name(new.gathering_id)
      || ', so it''s closed. You''re all still in the room.';
  elsif new.state = 'spot_set' then
    v_body := 'Your group for ' || private.gathering_name(new.gathering_id) || ' meets '
      || case when v_spot is null then 'at the start' else 'at ' || v_spot end || '.';
  elsif new.state = 'live' then
    v_kind := 'day_of';
    v_path := '/group/' || new.id;
    v_when := case when extract(hour from (select g.starts_at from public.gatherings g where g.id = new.gathering_id) at time zone v_tz) >= 17
                   then 'Tonight' else 'Today' end;
    v_body := case when v_spot is null
      then v_when || ': find your group at the start — tap when you''re there'
      else v_when || ': your group meets at ' || v_spot || ' at '
           || to_char(new.meet_at at time zone v_tz, 'FMHH12:MI am') || ' — tap when you''re there' end;
  else
    return new;
  end if;
  -- Everyone who was in it at that moment (a dissolve releases people in the same run,
  -- so members who left at or after the change are included).
  insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
  select m.person_id, v_kind, new.gathering_id, new.id,
         private.gathering_name(new.gathering_id), v_body, v_path
  from public.crew_members m
  join public.people p on p.id = m.person_id
  where m.crew_id = new.id
    and (m.left_at is null or (new.state = 'dissolved' and m.left_at >= now() - interval '1 minute'))
    and p.hidden_at is null
    and private.wants(m.person_id, v_kind)
  on conflict do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4: #5 next morning, 9am local — pg_cron, hourly
-- ---------------------------------------------------------------------------

-- The morning after the night: an end before 6am belongs to the night before it.
create function private.next_morning_at(p_gathering uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((((public.effective_end(g) - interval '6 hours') at time zone private.gathering_tz(g.id))::date + 1) + time '09:00')
         at time zone private.gathering_tz(g.id)
  from public.gatherings g where g.id = p_gathering;
$$;
revoke all on function private.next_morning_at(uuid) from public;

-- Everyone who was open to meeting: "Did you meet up?" to a finished group's members,
-- only the question to everyone else. Inside the day after 9am only, so a late run
-- never sends a backlog. `p_now` is for the harness.
create function public.admin_next_morning_tick(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
  select pi.person_id, 'next_morning', g.id, cm.crew_id, g.name,
         case when cm.crew_id is not null
           then 'Did you meet up at ' || g.name || '? Tick who you met.'
           else 'How was ' || g.name || '? One quick question, if you have a second.' end,
         '/after/' || coalesce(g.slug, g.id::text)
  from public.gatherings g
  join public.pins pi on pi.gathering_id = g.id and pi.open_to_meeting
  join public.people pe on pe.id = pi.person_id and pe.hidden_at is null
  left join lateral (
    select m.crew_id from public.crew_members m join public.crews c on c.id = m.crew_id
    where m.person_id = pi.person_id and m.gathering_id = g.id and m.left_at is null and c.state = 'done'
    limit 1
  ) cm on true
  where g.published_at is not null and g.withdrawn_at is null
    and g.starts_at between p_now - interval '4 days' and p_now
    and p_now >= private.next_morning_at(g.id)
    and p_now < private.next_morning_at(g.id) + interval '1 day'
    and private.wants(pi.person_id, 'next_morning')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.admin_next_morning_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_next_morning_tick(timestamptz) to service_role;

select cron.schedule('pind-next-morning', '5 * * * *', $$select public.admin_next_morning_tick()$$);

-- ---------------------------------------------------------------------------
-- c: invite (#7)
-- ---------------------------------------------------------------------------

create table public.connection_invites (
  id            uuid primary key default gen_random_uuid(),
  from_person   uuid not null references public.people (id) on delete cascade,
  to_person     uuid not null references public.people (id) on delete cascade,
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint connection_invites_not_self check (from_person <> to_person)
);
alter table public.connection_invites enable row level security;
revoke all on public.connection_invites from public, anon, authenticated;
-- One per pair per gathering, whichever of the two sends it.
create unique index connection_invites_once on public.connection_invites
  (least(from_person, to_person), greatest(from_person, to_person), gathering_id);
create index connection_invites_from_idx on public.connection_invites (from_person, created_at);

create function private.person_is_tester(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.testers t join public.people pe on pe.auth_user_id = t.auth_user_id where pe.id = p_person);
$$;
revoke all on function private.person_is_tester(uuid) from public;

-- My upcoming pins, and whether each connection is already going or already invited —
-- what A20's picker needs, and nothing about anyone else.
create function public.invite_options(p_to uuid)
returns table (gathering_id uuid, name text, slug text, starts_at timestamptz, already text)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.slug, g.starts_at,
    case
      when exists (select 1 from public.pins p where p.person_id = p_to and p.gathering_id = g.id) then 'going'
      when exists (select 1 from public.connection_invites i where i.gathering_id = g.id
                   and least(i.from_person, i.to_person) = least(private.me(), p_to)
                   and greatest(i.from_person, i.to_person) = greatest(private.me(), p_to)) then 'invited'
    end
  from public.pins mine join public.gatherings g on g.id = mine.gathering_id
  where mine.person_id = private.me() and private.are_connected(p_to)
    and g.published_at is not null and g.withdrawn_at is null and g.starts_at > now()
    and (not g.is_seed or private.person_is_tester(p_to))
  order by g.starts_at;
$$;
revoke all on function public.invite_options(uuid) from public, anon;
grant execute on function public.invite_options(uuid) to authenticated;

create function public.invite_connection(p_to uuid, p_gathering uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  g public.gatherings;
begin
  if v_me is null or not private.are_connected(p_to) or private.blocked_between(v_me, p_to)
     or exists (select 1 from public.people t where t.id = p_to and t.hidden_at is not null) then
    raise exception 'refused: not connected' using errcode = '42501';
  end if;
  select * into g from public.gatherings where id = p_gathering;
  if not found or g.published_at is null or g.withdrawn_at is not null or g.starts_at <= now()
     or (g.is_seed and not (private.person_is_tester(v_me) and private.person_is_tester(p_to))) then
    raise exception 'refused: not an upcoming gathering' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pins p where p.person_id = v_me and p.gathering_id = p_gathering) then
    raise exception 'refused: pin in first' using errcode = '42501';
  end if;
  if exists (select 1 from public.pins p where p.person_id = p_to and p.gathering_id = p_gathering) then
    raise exception 'refused: already going' using errcode = '42501';
  end if;
  if (select count(*) from public.connection_invites i where i.from_person = v_me and i.created_at > now() - interval '1 day') >= 5 then
    raise exception 'rate: five invites a day' using errcode = '42501';
  end if;
  insert into public.connection_invites (from_person, to_person, gathering_id) values (v_me, p_to, p_gathering);
end;
$$;
revoke all on function public.invite_connection(uuid, uuid) from public, anon;
grant execute on function public.invite_connection(uuid, uuid) to authenticated;

create function private.notify_connection_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (person_id, kind, gathering_id, title, body, path)
  select new.to_person, 'invite', new.gathering_id, private.gathering_name(new.gathering_id),
         f.first_name || '''s going to ' || private.gathering_name(new.gathering_id) || ' — want to come?',
         private.crowd_path(new.gathering_id)
  from public.people f
  where f.id = new.from_person and private.wants(new.to_person, 'invite');
  return new;
end;
$$;
revoke all on function private.notify_connection_invite() from public;
create trigger connection_invites_notify after insert on public.connection_invites
  for each row execute function private.notify_connection_invite();
