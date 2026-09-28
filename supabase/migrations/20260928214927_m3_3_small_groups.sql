-- M3.3 — small groups: "go together" from the room (Alex, with Tatiana and Jayme,
-- 28 Sept 2026; build plan §8 M3.3, first version).
--
-- The room is for getting conversation going; the group is for the night. You pull 2 or
-- 3 people you have talked with in the room into a group, by invite — no requests, no
-- approvals. The spot and the plan live in the group. The crew tables are reused
-- (`crews`, `crew_members`, `crew_proposals`, `crew_proposal_votes`, `crew_messages`);
-- join requests are dropped.
--
-- Who can see what (approved by Alex):
--   * **an invite** can be sent only between two people who are both in the same room,
--     have both posted there, and can see each other (no block, neither hidden); only
--     the invitee sees it; the inviter never learns of a decline;
--   * **a group and its thread**: only its members can see that it exists, and only they
--     read or post in it. The room cannot see who went with whom.
-- The lifecycle (approved): forming while invites are out and it has fewer than 3; on at
-- 3; spot set when the plan is chosen — by the leader three hours before, or at once
-- "at the start" where the gathering meets at the gathering; live from three hours
-- before; done after the effective end; a forming group under 3 at six hours before is
-- dissolved. Once its spot is set, a group survives people leaving. Invites expire at
-- the gathering's start.

-- ---------------------------------------------------------------------------
-- How a gathering convenes (decided after the community walk; built here)
-- ---------------------------------------------------------------------------

create type public.convening as enum ('at_the_gathering', 'a_spot_first', 'after');
alter table public.gatherings add column convening public.convening;
comment on column public.gatherings.convening is
  'How a group meets (M3.3). Null: the default — a spot first for Events (Ticketmaster), at the gathering for Community.';

create function public.convening_of(p_gathering uuid) returns public.convening
language sql stable security definer set search_path = '' as $$
  select coalesce(g.convening,
    case when g.source = 'ticketmaster' then 'a_spot_first'::public.convening else 'at_the_gathering'::public.convening end)
  from public.gatherings g where g.id = p_gathering;
$$;
revoke all on function public.convening_of(uuid) from public;
grant execute on function public.convening_of(uuid) to anon, authenticated;

-- The spot poll's time: sixty minutes before, thirty for a morning gathering (Alex, M2.2).
alter table public.cities add column meet_offset_minutes smallint not null default 60 check (meet_offset_minutes between 0 and 240);
alter table public.cities add column meet_offset_morning_minutes smallint not null default 30 check (meet_offset_morning_minutes between 0 and 240);

create function private.meet_time(p_gathering uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case public.convening_of(g.id)
    when 'after' then public.effective_end(g)
    else g.starts_at - make_interval(mins => case
      when extract(hour from g.starts_at at time zone coalesce(c.timezone, 'America/Toronto')) < 12
        then coalesce(c.meet_offset_morning_minutes, 30) else coalesce(c.meet_offset_minutes, 60) end)
  end
  from public.gatherings g
  left join public.venues v on v.id = g.venue_id
  left join public.cities c on c.slug = v.city
  where g.id = p_gathering;
$$;
revoke all on function private.meet_time(uuid) from public;

-- ---------------------------------------------------------------------------
-- The crew tables, reshaped for groups
-- ---------------------------------------------------------------------------

drop table public.crew_join_requests;
drop type public.join_request_status;

alter table public.crews add column room_id uuid references public.rooms (id) on delete set null;
-- A plan "at the start" has a time and no spot.
alter table public.crews drop constraint crews_spot_matches_state;
alter table public.crews add constraint crews_plan_matches_state check (
  (state in ('forming', 'dissolved') and spot_id is null and meet_at is null)
  or (state in ('spot_set', 'live', 'done') and meet_at is not null)
);

create type public.invite_status as enum ('sent', 'accepted', 'declined', 'expired', 'withdrawn');
create table public.crew_invites (
  id           uuid primary key default gen_random_uuid(),
  crew_id      uuid not null references public.crews (id) on delete cascade,
  gathering_id uuid not null references public.gatherings (id) on delete cascade,
  from_person  uuid not null references public.people (id) on delete cascade,
  to_person    uuid not null references public.people (id) on delete cascade,
  status       public.invite_status not null default 'sent',
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  constraint crew_invites_not_self check (from_person <> to_person),
  constraint crew_invites_decided check ((status = 'sent') = (decided_at is null))
);
alter table public.crew_invites enable row level security;
create unique index crew_invites_one_open on public.crew_invites (crew_id, to_person) where status = 'sent';
create index crew_invites_to_idx on public.crew_invites (to_person) where status = 'sent';

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

create function private.active_members(p_crew uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.crew_members m where m.crew_id = p_crew and m.left_at is null;
$$;
revoke all on function private.active_members(uuid) from public;

-- I am in this group now.
create function private.in_group(p_crew uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crew_members m where m.crew_id = p_crew and m.person_id = private.me() and m.left_at is null);
$$;
revoke all on function private.in_group(uuid) from public;
grant execute on function private.in_group(uuid) to authenticated;

-- "Someone you've talked with": both of us in this room now, both have posted in it,
-- and I can see them there.
create function private.can_invite(p_room uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.room_id = p_room and mine.person_id = private.me() and mine.left_at is null and mine.first_posted_at is not null
      and theirs.person_id = p_person and theirs.left_at is null and theirs.first_posted_at is not null
      and p_person <> private.me()
      and private.room_peer(p_person, mine.gathering_id)
      and not exists (
        select 1 from public.crew_members g
        join public.crews c on c.id = g.crew_id
        where g.person_id = p_person and g.gathering_id = mine.gathering_id and g.left_at is null and c.state <> 'dissolved'
      )
  );
$$;
revoke all on function private.can_invite(uuid, uuid) from public;
grant execute on function private.can_invite(uuid, uuid) to authenticated;

-- "Go together": a group from this room, and invites to 2 or 3 people you have talked with.
create function public.start_group(p_room uuid, p_invitees uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_room public.rooms;
  v_crew uuid;
  v_person uuid;
  v_starts timestamptz;
begin
  select * into v_room from public.rooms where id = p_room;
  if v_room.id is null or not private.in_room(p_room) then
    raise exception 'refused: not your room' using errcode = '42501';
  end if;
  if not exists (select 1 from public.room_members where room_id = p_room and person_id = v_me and first_posted_at is not null) then
    raise exception 'refused: say hi first' using errcode = '42501';
  end if;
  select starts_at into v_starts from public.gatherings where id = v_room.gathering_id;
  if now() >= v_starts then
    raise exception 'refused: the gathering has started' using errcode = '42501';
  end if;
  if coalesce(array_length(p_invitees, 1), 0) not between 2 and 3
     or (select count(distinct x) from unnest(p_invitees) x) <> array_length(p_invitees, 1) then
    raise exception 'refused: invite 2 or 3 people' using errcode = '22023';
  end if;
  foreach v_person in array p_invitees loop
    if not private.can_invite(p_room, v_person) then
      raise exception 'refused: you can invite only people you have talked with here' using errcode = '42501';
    end if;
  end loop;

  insert into public.crews (gathering_id, room_id, women_only) values (v_room.gathering_id, p_room, v_room.women_only)
  returning id into v_crew;
  -- One group per person per gathering: the unique index refuses a second.
  insert into public.crew_members (crew_id, gathering_id, person_id) values (v_crew, v_room.gathering_id, v_me);
  insert into public.crew_invites (crew_id, gathering_id, from_person, to_person)
  select v_crew, v_room.gathering_id, v_me, x from unnest(p_invitees) x;
  -- The plan's options: the gathering's spots, at its meet time.
  if public.convening_of(v_room.gathering_id) <> 'at_the_gathering' then
    insert into public.crew_proposals (crew_id, spot_id, meet_at, proposed_by)
    select v_crew, gs.spot_id, private.meet_time(v_room.gathering_id), null
    from public.gathering_spots gs where gs.gathering_id = v_room.gathering_id
    on conflict do nothing;
  end if;
  return v_crew;
end;
$$;
revoke all on function public.start_group(uuid, uuid[]) from public, anon;
grant execute on function public.start_group(uuid, uuid[]) to authenticated;

-- Accept or decline. Declining sends nothing to anyone.
create function public.respond_to_invite(p_invite uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.crew_invites;
  v_crew public.crews;
  v_starts timestamptz;
begin
  select * into v_inv from public.crew_invites where id = p_invite and to_person = private.me() and status = 'sent';
  if v_inv.id is null then
    raise exception 'refused: no such invite' using errcode = '42501';
  end if;
  if not p_accept then
    update public.crew_invites set status = 'declined', decided_at = now() where id = p_invite;
    return;
  end if;
  select * into v_crew from public.crews where id = v_inv.crew_id;
  select starts_at into v_starts from public.gatherings where id = v_inv.gathering_id;
  if v_crew.state = 'dissolved' or now() >= v_starts then
    update public.crew_invites set status = 'expired', decided_at = now() where id = p_invite;
    raise exception 'refused: that group is no longer open' using errcode = '42501';
  end if;
  insert into public.crew_members (crew_id, gathering_id, person_id) values (v_inv.crew_id, v_inv.gathering_id, v_inv.to_person);
  update public.crew_invites set status = 'accepted', decided_at = now() where id = p_invite;
  -- Any other open invites to me at this gathering lapse: one group per person.
  update public.crew_invites set status = 'withdrawn', decided_at = now()
  where to_person = v_inv.to_person and gathering_id = v_inv.gathering_id and status = 'sent';
  -- At 3, a group that meets at the gathering has its plan at once: "at the start".
  if private.active_members(v_inv.crew_id) >= 3 and v_crew.state = 'forming'
     and public.convening_of(v_inv.gathering_id) = 'at_the_gathering' then
    update public.crews set state = 'spot_set', meet_at = v_starts where id = v_inv.crew_id;
  end if;
end;
$$;
revoke all on function public.respond_to_invite(uuid, boolean) from public, anon;
grant execute on function public.respond_to_invite(uuid, boolean) to authenticated;

-- The invites waiting for me: who asked, and who else is in — only people I can see.
create function public.my_invites(p_gathering uuid)
returns table (invite_id uuid, crew_id uuid, from_name text, members text[])
language sql stable security definer set search_path = '' as $$
  select i.id, i.crew_id, f.first_name,
    array(
      select p.first_name from public.crew_members m join public.people p on p.id = m.person_id
      where m.crew_id = i.crew_id and m.left_at is null and m.person_id <> i.from_person
        and private.room_peer(m.person_id, i.gathering_id)
    )
  from public.crew_invites i
  join public.people f on f.id = i.from_person
  where i.to_person = private.me() and i.gathering_id = p_gathering and i.status = 'sent'
    and private.room_peer(i.from_person, i.gathering_id);
$$;
revoke all on function public.my_invites(uuid) from public, anon;
grant execute on function public.my_invites(uuid) to authenticated;

create function public.leave_group(p_crew uuid) returns void
language sql security definer set search_path = '' as $$
  update public.crew_members set left_at = now()
  where crew_id = p_crew and person_id = private.me() and left_at is null;
$$;
revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies: a group and everything in it belong to its members.
-- ---------------------------------------------------------------------------

grant select on public.crews, public.crew_members, public.crew_proposals, public.crew_proposal_votes, public.crew_invites to authenticated;
grant select, delete on public.crew_messages to authenticated;
grant insert (crew_id, author_id, kind, body) on public.crew_messages to authenticated;
grant insert (proposal_id, person_id), delete on public.crew_proposal_votes to authenticated;
grant update (arrived_at, arrival_note) on public.crew_members to authenticated;

create policy crews_read_members on public.crews
  for select to authenticated using (private.in_group(id));
create policy crew_members_read_members on public.crew_members
  for select to authenticated using (private.in_group(crew_id) and (left_at is null or person_id = private.me()));
create policy crew_proposals_read_members on public.crew_proposals
  for select to authenticated using (private.in_group(crew_id));
create policy crew_votes_read_members on public.crew_proposal_votes
  for select to authenticated using (
    private.in_group((select p.crew_id from public.crew_proposals p where p.id = proposal_id))
  );
create policy crew_votes_cast_own on public.crew_proposal_votes
  for insert to authenticated with check (
    person_id = private.me()
    and exists (
      select 1 from public.crew_proposals p join public.crews c on c.id = p.crew_id
      where p.id = proposal_id and private.in_group(p.crew_id) and c.state = 'forming'
    )
  );
create policy crew_votes_withdraw_own on public.crew_proposal_votes
  for delete to authenticated using (person_id = private.me());
create policy crew_invites_read_invitee on public.crew_invites
  for select to authenticated using (to_person = private.me());

create policy crew_messages_read_members on public.crew_messages
  for select to authenticated using (private.in_group(crew_id) and (hidden_at is null or author_id = private.me()));
create policy crew_messages_post_members on public.crew_messages
  for insert to authenticated with check (
    author_id = private.me()
    and kind = 'user'
    and private.in_group(crew_id)
    and exists (
      select 1 from public.crews c join public.gatherings g on g.id = c.gathering_id
      where c.id = crew_id and c.state <> 'dissolved' and now() < public.effective_end(g) + interval '24 hours'
    )
  );
create policy crew_messages_delete_own on public.crew_messages
  for delete to authenticated using (author_id = private.me());

-- "I'm here": your own row, while the group is live, with a line of text (Q7).
create policy crew_members_arrive_own on public.crew_members
  for update to authenticated
  using (person_id = private.me() and left_at is null)
  with check (
    person_id = private.me()
    and exists (select 1 from public.crews c where c.id = crew_id and c.state = 'live')
  );

-- The group thread's messages: 500 characters, like the room's (constraint kept wider
-- for system posts).
alter table public.crew_messages add constraint crew_messages_user_length
  check (kind <> 'user' or char_length(btrim(body)) between 1 and 500);

-- ---------------------------------------------------------------------------
-- Time: every ten minutes, the lifecycle moves (pg_cron).
-- ---------------------------------------------------------------------------

create function public.admin_groups_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expired int; v_dissolved int; v_planned int; v_live int; v_done int;
begin
  update public.crew_invites i set status = 'expired', decided_at = now()
  from public.gatherings g
  where g.id = i.gathering_id and i.status = 'sent' and now() >= g.starts_at;
  get diagnostics v_expired = row_count;

  -- Under 3 at six hours before: dissolved. Its people are still in the room.
  update public.crews c set state = 'dissolved', dissolved_at = now()
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'forming'
    and now() >= g.starts_at - interval '6 hours'
    and private.active_members(c.id) < 3;
  get diagnostics v_dissolved = row_count;
  -- A dissolved group releases its people, so they can go with someone else.
  update public.crew_members m set left_at = now()
  from public.crews c
  where c.id = m.crew_id and c.state = 'dissolved' and m.left_at is null;

  -- Three hours before, a group of 3+ with no plan takes the poll's leader (most votes,
  -- then the earliest time), or "at the start" when there is no poll.
  update public.crews c
  set state = 'spot_set',
      spot_id = lead.spot_id,
      meet_at = coalesce(lead.meet_at, g.starts_at)
  from public.gatherings g
  left join lateral (
    select p.spot_id, p.meet_at from public.crew_proposals p
    left join public.crew_proposal_votes v on v.proposal_id = p.id
    where p.crew_id = c.id
    group by p.id, p.spot_id, p.meet_at
    order by count(v.person_id) desc, p.meet_at, p.created_at
    limit 1
  ) lead on true
  where g.id = c.gathering_id and c.state = 'forming'
    and now() >= g.starts_at - interval '3 hours'
    and private.active_members(c.id) >= 3;
  get diagnostics v_planned = row_count;

  update public.crews c set state = 'live'
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'spot_set' and now() >= g.starts_at - interval '3 hours';
  get diagnostics v_live = row_count;

  update public.crews c set state = 'done'
  from public.gatherings g
  where g.id = c.gathering_id and c.state in ('spot_set', 'live') and now() >= public.effective_end(g);
  get diagnostics v_done = row_count;

  return jsonb_build_object('expired', v_expired, 'dissolved', v_dissolved, 'planned', v_planned, 'live', v_live, 'done', v_done);
end;
$$;
revoke all on function public.admin_groups_tick() from public, anon, authenticated;
grant execute on function public.admin_groups_tick() to service_role;
select cron.schedule('pind-groups-tick', '*/10 * * * *', $$select public.admin_groups_tick()$$);

alter publication supabase_realtime add table public.crew_messages;
