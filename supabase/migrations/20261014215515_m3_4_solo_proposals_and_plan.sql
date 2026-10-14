-- M3.4 — 1-on-1 proposals and the plan (A29). The lifecycle approved by Alex on 14 Oct
-- 2026 (decisions, "M3.4: the 1-on-1 lifecycle"); the visibility under it is
-- m3_4_solo_visibility's, approved the same day.
--
-- A proposal: open → accepted / declined / withdrawn / expired / closed.
--   * sent only when you can see them in 1-on-1 now, before the start, with one of the
--     venue's active spots, a time from 3 h before the start to 2 h after the effective end
--     in 15-minute steps (never in the past), one of five preset lines (a key; the words are
--     packages/shared's), fewer than 3 open, and never before between the two of you there;
--   * accepted: checked again, the plan made, every other open proposal to or from either
--     of them there closed silently;
--   * declined: nothing is sent. To the sender a declined proposal is an unanswered one in
--     every respect until the start — shown as sent, counted toward their 3, closed by the
--     same rules;
--   * withdrawn by its sender: frees a slot; the pair stays used;
--   * closed, silently, when the rule stops holding: a block, out of 1-on-1, hidden, 1-on-1
--     or meeting switched off (or women only, against someone outside it), the pin removed,
--     the gathering withdrawn;
--   * expired at the start.
--
-- The plan: a group (crews) of kind 'solo', two seats, born in spot_set at accept with the
-- proposal's spot and time → live 3 h before → done at the later of the effective end and
-- an hour after its meeting time (a meet after the end must not be over before it starts)
-- — or dissolved: either leaves (blocking the other is leaving), or H9 hides either person,
-- the plan or a message in its thread. One group and one 1-on-1 plan per person per
-- gathering. No editing in v1.
--
-- Two calls made here and flagged (decisions): someone with a 1-on-1 plan at a gathering
-- leaves everyone else's 1-on-1 list there (narrowing only — the alternative was a refusal
-- that tells the sender they have one); and the per-platform switch is a row the app reads.

-- ---------------------------------------------------------------------------
-- The plan is a group of kind 'solo'
-- ---------------------------------------------------------------------------

create type public.crew_kind as enum ('crew', 'solo');

alter table public.crews add column kind public.crew_kind not null default 'crew';
alter table public.crews add constraint crews_id_gathering_kind unique (id, gathering_id, kind);
comment on column public.crews.kind is
  'crew: a small group from the room (M3.3). solo: a 1-on-1 plan, two seats, made by an accepted proposal (M3.4).';

-- The membership carries its group's kind, pinned to it by the foreign key, so "one at a
-- time" is a plain index per kind: one group AND one 1-on-1 plan per person per gathering.
alter table public.crew_members add column kind public.crew_kind not null default 'crew';
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.crew_members'::regclass and contype = 'f' and confrelid = 'public.crews'::regclass
  loop
    execute format('alter table public.crew_members drop constraint %I', r.conname);
  end loop;
end;
$$;
alter table public.crew_members add constraint crew_members_crew_fkey
  foreign key (crew_id, gathering_id, kind) references public.crews (id, gathering_id, kind) on delete cascade;
drop index public.crew_members_one_active_crew_per_gathering;
create unique index crew_members_one_active_per_kind
  on public.crew_members (gathering_id, person_id, kind) where left_at is null;

-- A 1-on-1 plan has a spot and a time from birth, and is never a group's "at the start".
alter table public.crews add constraint crews_solo_has_spot check (kind = 'crew' or state = 'dissolved' or spot_id is not null);

-- In a 1-on-1 plan at this gathering (set, live or done).
create function private.in_solo_plan(p_person uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.crew_members m join public.crews c on c.id = m.crew_id
    where m.person_id = p_person and m.gathering_id = p_gathering and m.kind = 'solo' and m.left_at is null
      and c.state in ('spot_set', 'live', 'done')
  );
$$;
revoke all on function private.in_solo_plan(uuid, uuid) from public;

-- "Someone you've talked with" is for groups: a 1-on-1 plan does not stop a group invite.
create or replace function private.can_invite(p_room uuid, p_person uuid) returns boolean
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
        where g.person_id = p_person and g.gathering_id = mine.gathering_id and g.left_at is null
          and c.state <> 'dissolved' and c.kind = 'crew'
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- The rule, narrowed: a 1-on-1 plan takes both people out of the list there
-- ---------------------------------------------------------------------------

create or replace function private.can_see_solo(p_target uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.can_see_at(p_target, p_gathering)
       and mine is not null
       and theirs is not null
       and not exists (
         select 1 from public.people pe where pe.id in (me.id, p_target) and pe.hidden_from_solo
       )
       and (mine = 'everyone' or private.is_women_only_eligible(p_target))
       and (theirs = 'everyone' or private.is_women_only_eligible(me.id))
       and not private.in_solo_plan(me.id, p_gathering)
       and not private.in_solo_plan(p_target, p_gathering)
    from (select private.me() as id) me
    cross join lateral (select private.solo_choice(me.id, p_gathering) as mine) a
    cross join lateral (select private.solo_choice(p_target, p_gathering) as theirs) b
    where me.id is not null
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- No spots, no 1-on-1 — counted, not silent
-- ---------------------------------------------------------------------------

create function private.has_spots(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g join public.meeting_spots s on s.venue_id = g.venue_id
    where g.id = p_gathering and s.active
  );
$$;
revoke all on function private.has_spots(uuid) from public;

create function private.pins_solo_needs_spots() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.solo_opt_in and not old.solo_opt_in and not private.has_spots(new.gathering_id) then
    raise exception 'This gathering has no meeting spots, so 1-on-1 is not offered here.'
      using errcode = 'check_violation', hint = 'solo_no_spots';
  end if;
  return new;
end;
$$;
revoke all on function private.pins_solo_needs_spots() from public;
create trigger pins_solo_needs_spots before update of solo_opt_in on public.pins
  for each row execute function private.pins_solo_needs_spots();

-- The admin's count (Venues, beside the missing maps): upcoming published gatherings
-- with no active spot, so no 1-on-1. If it is high, §7's groups-vs-solo comparison
-- measures availability, not preference (decisions).
create function public.admin_gatherings_without_spots()
returns table (gathering_id uuid, name text, slug text, starts_at timestamptz, venue_id uuid, venue_name text)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.slug, g.starts_at, g.venue_id, v.name
  from public.gatherings g
  left join public.venues v on v.id = g.venue_id
  where g.published_at is not null and g.withdrawn_at is null and not g.is_seed
    and public.effective_end(g) > now()
    and not private.has_spots(g.id)
  order by g.starts_at;
$$;
revoke all on function public.admin_gatherings_without_spots() from public, anon, authenticated;
grant execute on function public.admin_gatherings_without_spots() to service_role;

-- ---------------------------------------------------------------------------
-- Proposals
-- ---------------------------------------------------------------------------

create type public.solo_proposal_status as enum ('open', 'accepted', 'declined', 'withdrawn', 'expired', 'closed');

create table public.solo_proposals (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  from_person   uuid not null references public.people (id) on delete cascade,
  to_person     uuid not null references public.people (id) on delete cascade,
  spot_id       uuid not null references public.meeting_spots (id) on delete restrict,
  meet_at       timestamptz not null,
  -- One of the five preset lines (A29), by number. Its words are packages/shared's.
  line          smallint not null check (line between 1 and 5),
  status        public.solo_proposal_status not null default 'open',
  crew_id       uuid references public.crews (id) on delete set null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  constraint solo_proposals_not_self check (from_person <> to_person),
  constraint solo_proposals_decided check ((status = 'open') = (decided_at is null))
);
comment on table public.solo_proposals is
  'A29 (M3.4). Read only through my_solo_proposals and the export: to the sender a declined proposal is an open one. Deleted with the pin after the gathering.';
alter table public.solo_proposals enable row level security;
revoke all on public.solo_proposals from public, anon, authenticated;
-- One per pair per gathering, ever, whichever of the two sends it.
create unique index solo_proposals_once_per_pair on public.solo_proposals
  (gathering_id, least(from_person, to_person), greatest(from_person, to_person));
create index solo_proposals_from_idx on public.solo_proposals (from_person, gathering_id);
create index solo_proposals_to_idx on public.solo_proposals (to_person, gathering_id);

-- The times on offer (Alex, 14 Oct): from 3 h before the start to 2 h after the effective
-- end, on the quarter hour, not in the past. packages/shared's soloTimes() offers the same.
create function private.solo_time_ok(p_gathering uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    where g.id = p_gathering
      and p_at >= g.starts_at - interval '3 hours'
      and p_at <= public.effective_end(g) + interval '2 hours'
      and p_at > now()
      and extract(epoch from p_at)::bigint % 900 = 0
  );
$$;
revoke all on function private.solo_time_ok(uuid, timestamptz) from public;

-- What counts toward the sender's 3, and what they see as sent: open and declined alike.
create function private.solo_pending(p_status public.solo_proposal_status) returns boolean
language sql immutable set search_path = '' as $$
  select p_status in ('open', 'declined');
$$;

create function public.propose_solo(p_gathering uuid, p_to uuid, p_spot uuid, p_meet_at timestamptz, p_line smallint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'refused: no person' using errcode = '42501';
  end if;
  -- One sender's proposals are counted one at a time (as R89's invites).
  perform pg_advisory_xact_lock(hashtext('solo_proposals:' || v_me::text || ':' || p_gathering::text));
  if exists (select 1 from public.gatherings g where g.id = p_gathering and now() >= g.starts_at) then
    raise exception 'refused: proposals closed at the start' using errcode = '42501';
  end if;
  if not private.can_see_solo(p_to, p_gathering) then
    raise exception 'refused: not available for 1-on-1' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.gatherings g join public.meeting_spots s on s.venue_id = g.venue_id
    where g.id = p_gathering and s.id = p_spot and s.active
  ) then
    raise exception 'refused: not one of this venue''s spots' using errcode = '22023';
  end if;
  if not private.solo_time_ok(p_gathering, p_meet_at) then
    raise exception 'refused: not one of the times on offer' using errcode = '22023';
  end if;
  if p_line is null or p_line not between 1 and 5 then
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
    -- They asked you at the same moment.
    raise exception 'refused: already asked' using errcode = '42501';
  end;
  return v_id;
end;
$$;
revoke all on function public.propose_solo(uuid, uuid, uuid, timestamptz, smallint) from public, anon;
grant execute on function public.propose_solo(uuid, uuid, uuid, timestamptz, smallint) to authenticated;

-- Close every proposal still pending (open or declined) that matches — silently.
create function private.close_solo_proposals(p_gathering uuid, p_person uuid, p_other uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.solo_proposals p set status = 'closed', decided_at = coalesce(p.decided_at, now())
  where private.solo_pending(p.status)
    and (p_gathering is null or p.gathering_id = p_gathering)
    and (p.from_person = p_person or p.to_person = p_person)
    and (p_other is null or p.from_person = p_other or p.to_person = p_other);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.close_solo_proposals(uuid, uuid, uuid) from public;

create function public.respond_to_solo(p_proposal uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.solo_proposals;
  v_crew uuid;
begin
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
  -- What sending checked, checked again now; the same words whatever changed (R59).
  if exists (select 1 from public.gatherings g where g.id = v_p.gathering_id and now() >= g.starts_at)
     or not private.can_see_solo(v_p.from_person, v_p.gathering_id)
     or not exists (select 1 from public.meeting_spots s where s.id = v_p.spot_id and s.active) then
    update public.solo_proposals set status = 'closed', decided_at = now() where id = p_proposal;
    raise exception 'refused: that proposal is no longer open' using errcode = '42501';
  end if;
  begin
    insert into public.crews (gathering_id, kind, state, spot_id, meet_at)
    values (v_p.gathering_id, 'solo', 'spot_set', v_p.spot_id, v_p.meet_at)
    returning id into v_crew;
    insert into public.crew_members (crew_id, gathering_id, person_id, kind)
    values (v_crew, v_p.gathering_id, v_p.from_person, 'solo'), (v_crew, v_p.gathering_id, v_p.to_person, 'solo');
  exception when unique_violation then
    -- Either of them made another 1-on-1 plan here at the same moment.
    raise exception 'refused: that proposal is no longer open' using errcode = '42501';
  end;
  update public.solo_proposals set status = 'accepted', decided_at = now(), crew_id = v_crew where id = p_proposal;
  -- One 1-on-1 plan per person per gathering: everything else pending for either closes.
  perform private.close_solo_proposals(v_p.gathering_id, v_p.from_person);
  perform private.close_solo_proposals(v_p.gathering_id, v_p.to_person);
  return v_crew;
end;
$$;
revoke all on function public.respond_to_solo(uuid, boolean) from public, anon;
grant execute on function public.respond_to_solo(uuid, boolean) to authenticated;

create function public.withdraw_solo(p_proposal uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.solo_proposals set status = 'withdrawn', decided_at = coalesce(decided_at, now())
  where id = p_proposal and from_person = private.me() and private.solo_pending(status);
  if not found then
    raise exception 'refused: no such proposal' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.withdraw_solo(uuid) from public, anon;
grant execute on function public.withdraw_solo(uuid) to authenticated;

-- My proposals at a gathering, as I may know them: those I received and can still answer,
-- and those I sent and have not heard back on (a declined one among them, unmarked).
-- Nothing after the start.
create function public.my_solo_proposals(p_gathering uuid)
returns table (proposal_id uuid, direction text, person_id uuid, first_name text, spot_id uuid, spot_name text, meet_at timestamptz, line smallint, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, case when p.to_person = private.me() then 'received' else 'sent' end,
         o.id, o.first_name, s.id, s.name, p.meet_at, p.line, p.created_at
  from public.solo_proposals p
  join public.gatherings g on g.id = p.gathering_id
  join public.meeting_spots s on s.id = p.spot_id
  join public.people o on o.id = case when p.to_person = private.me() then p.from_person else p.to_person end
  where p.gathering_id = p_gathering
    and now() < g.starts_at
    and not private.blocked_between(p.from_person, p.to_person)
    and (
      (p.to_person = private.me() and p.status = 'open' and private.can_see_solo(p.from_person, p.gathering_id))
      or (p.from_person = private.me() and private.solo_pending(p.status))
    )
  order by p.created_at;
$$;
revoke all on function public.my_solo_proposals(uuid) from public, anon;
grant execute on function public.my_solo_proposals(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Closing silently when the rule stops holding
-- ---------------------------------------------------------------------------

create or replace function private.blocks_blocker_leaves_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.crew_members mine set left_at = now()
  from public.crew_members theirs, public.crews c
  where mine.person_id = new.blocker_id and mine.left_at is null
    and theirs.crew_id = mine.crew_id and theirs.person_id = new.blocked_id and theirs.left_at is null
    and c.id = mine.crew_id and c.state in ('forming', 'spot_set', 'live');
  -- Invites between the two lapse, whichever way they ran.
  update public.crew_invites set status = 'withdrawn', decided_at = now()
  where status = 'sent'
    and ((from_person = new.blocker_id and to_person = new.blocked_id)
      or (from_person = new.blocked_id and to_person = new.blocker_id));
  -- So do 1-on-1 proposals, at every gathering.
  perform private.close_solo_proposals(null, new.blocker_id, new.blocked_id);
  return new;
end;
$$;

create function private.pins_solo_closes_proposals() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- Retention: deleted with the pin once the gathering is over; closed before that, so
    -- removing a pin and pinning again does not reopen a pair.
    if exists (select 1 from public.gatherings g where g.id = old.gathering_id and now() >= public.effective_end(g)) then
      delete from public.solo_proposals p
      where p.gathering_id = old.gathering_id and old.person_id in (p.from_person, p.to_person);
    else
      perform private.close_solo_proposals(old.gathering_id, old.person_id);
    end if;
    return old;
  end if;
  if old.solo_opt_in and not new.solo_opt_in then
    perform private.close_solo_proposals(new.gathering_id, new.person_id);
  elsif new.solo_visibility = 'women_only' and old.solo_visibility is distinct from 'women_only' then
    update public.solo_proposals p set status = 'closed', decided_at = coalesce(p.decided_at, now())
    where private.solo_pending(p.status) and p.gathering_id = new.gathering_id
      and new.person_id in (p.from_person, p.to_person)
      and not private.is_women_only_eligible(case when p.from_person = new.person_id then p.to_person else p.from_person end);
  end if;
  return new;
end;
$$;
revoke all on function private.pins_solo_closes_proposals() from public;
-- Any update, not "update of solo_opt_in": switching meeting off turns 1-on-1 off inside a
-- BEFORE trigger, and a column trigger fires only for columns the statement names.
create trigger pins_solo_closes_proposals after update or delete on public.pins
  for each row execute function private.pins_solo_closes_proposals();

-- ---------------------------------------------------------------------------
-- The plan ends: leaving, or H9
-- ---------------------------------------------------------------------------

-- Dissolve a set or live 1-on-1 plan and release both. Told, with no reason: everyone in
-- it but p_except; a hidden person only when p_tell_hidden (H9 — Alex: both are told, or
-- the one hidden walks to a spot where nobody is coming).
create function private.dissolve_solo(p_crew uuid, p_tell_hidden boolean, p_except uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_g uuid;
begin
  update public.crews set state = 'dissolved', dissolved_at = now()
  where id = p_crew and kind = 'solo' and state in ('spot_set', 'live')
  returning gathering_id into v_g;
  if v_g is null then
    return;
  end if;
  insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
  select m.person_id, 'plan_status', v_g, p_crew, private.gathering_name(v_g),
         -- PROPOSED copy (Tatiana's to reword).
         'Your 1-on-1 for ' || private.gathering_name(v_g) || ' is off.',
         private.crowd_path(v_g)
  from public.crew_members m join public.people p on p.id = m.person_id
  where m.crew_id = p_crew
    and (m.left_at is null or m.left_at >= now() - interval '1 minute')
    and m.person_id is distinct from p_except
    and (p_tell_hidden or p.hidden_at is null)
    and private.wants(m.person_id, 'plan_status');
  update public.crew_members set left_at = now() where crew_id = p_crew and left_at is null;
end;
$$;
revoke all on function private.dissolve_solo(uuid, boolean, uuid) from public;

-- Either leaves (blocking the other leaves): the plan is off; the other is told.
create function private.solo_member_left() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'solo' and old.left_at is null and new.left_at is not null then
    perform private.dissolve_solo(new.crew_id, false, new.person_id);
  end if;
  return new;
end;
$$;
revoke all on function private.solo_member_left() from public;
create trigger crew_members_solo_left after update of left_at on public.crew_members
  for each row execute function private.solo_member_left();

-- H9 hides a person (by reports or by the admin): their 1-on-1 plans end, and their
-- pending proposals close. Out of 1-on-1 on a report below H9: proposals close; an
-- accepted plan stays (Alex: one malicious report shouldn't cancel it).
create function private.people_solo_follows_hide() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if (new.hidden_at is not null and old.hidden_at is null)
     or (new.hidden_from_solo and not old.hidden_from_solo) then
    update public.solo_proposals p set status = 'closed', decided_at = coalesce(p.decided_at, now())
    from public.gatherings g
    where g.id = p.gathering_id and now() < g.starts_at
      and private.solo_pending(p.status) and new.id in (p.from_person, p.to_person);
  end if;
  if new.hidden_at is not null and old.hidden_at is null then
    for r in
      select m.crew_id from public.crew_members m join public.crews c on c.id = m.crew_id
      where m.person_id = new.id and m.kind = 'solo' and m.left_at is null and c.state in ('spot_set', 'live')
    loop
      perform private.dissolve_solo(r.crew_id, true);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.people_solo_follows_hide() from public;
create trigger people_solo_follows_hide after update of hidden_at, hidden_from_solo on public.people
  for each row execute function private.people_solo_follows_hide();

create function private.crews_solo_follows_hide() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'solo' and new.hidden_at is not null and old.hidden_at is null then
    perform private.dissolve_solo(new.id, true);
  end if;
  return new;
end;
$$;
revoke all on function private.crews_solo_follows_hide() from public;
create trigger crews_solo_follows_hide after update of hidden_at on public.crews
  for each row execute function private.crews_solo_follows_hide();

create function private.crew_messages_solo_follows_hide() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.hidden_at is not null and old.hidden_at is null then
    perform private.dissolve_solo(new.crew_id, true);
  end if;
  return new;
end;
$$;
revoke all on function private.crew_messages_solo_follows_hide() from public;
create trigger crew_messages_solo_follows_hide after update of hidden_at on public.crew_messages
  for each row execute function private.crew_messages_solo_follows_hide();

-- A report on a 1-on-1 plan is a report on the other person in it: out of 1-on-1, as any
-- report on a person (m3_4_solo_visibility).
create or replace function private.report_takes_out_of_solo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_person uuid := coalesce(
    new.target_person_id,
    (select m.author_id from public.crew_messages m where m.id = new.target_message_id),
    (select m.author_id from public.room_messages m where m.id = new.target_room_message_id),
    (select m.person_id from public.crew_members m join public.crews c on c.id = m.crew_id
     where m.crew_id = new.target_crew_id and c.kind = 'solo' and m.person_id is distinct from new.reporter_id
     limit 1)
  );
begin
  if v_person is not null then
    update public.people set hidden_from_solo = true where id = v_person and not hidden_from_solo;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications: #8, and #3 to the sender on an accept
-- ---------------------------------------------------------------------------

alter table public.notification_settings add column solo_proposal boolean not null default true;
grant update (solo_proposal) on public.notification_settings to authenticated;

create or replace function private.wants(p_person uuid, p_kind public.notification_kind) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_kind
      when 'digest' then s.digest when 'room_open' then s.room_open when 'plan_status' then s.plan_status
      when 'day_of' then s.day_of when 'next_morning' then s.next_morning when 'room_activity' then s.room_activity
      when 'invite' then s.invite when 'solo_proposal' then s.solo_proposal end
    from public.notification_settings s where s.person_id = p_person
  ), true);
$$;

create function private.notify_solo_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := private.gathering_tz(new.gathering_id);
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (person_id, kind, gathering_id, title, body, path)
    select new.to_person, 'solo_proposal', new.gathering_id, private.gathering_name(new.gathering_id),
           -- PROPOSED copy (Tatiana's to reword).
           f.first_name || ' asked to meet you 1-on-1 at ' || private.gathering_name(new.gathering_id),
           private.crowd_path(new.gathering_id)
    from public.people f, public.people t
    where f.id = new.from_person and t.id = new.to_person
      and t.hidden_at is null
      and not private.blocked_between(new.from_person, new.to_person)
      and private.wants(new.to_person, 'solo_proposal');
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
revoke all on function private.notify_solo_proposal() from public;
create trigger solo_proposals_notify after insert or update of status on public.solo_proposals
  for each row execute function private.notify_solo_proposal();

-- #3 and #4 for groups, as m3_3_after_the_night, with 1-on-1 plans: born set and ended by
-- dissolve_solo (which tells), so only "live" speaks here — and when someone's group and
-- 1-on-1 plan go live in the same run, ONE day-of push names both (decisions).
create function private.day_of_part(p_crew uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when c.kind = 'solo' then 'your 1-on-1 meets ' else 'your group meets ' end
      || case when s.name is null then 'at the start'
              else 'at ' || s.name || ' at ' || to_char(c.meet_at at time zone private.gathering_tz(c.gathering_id), 'FMHH12:MI am') end
  from public.crews c left join public.meeting_spots s on s.id = c.spot_id
  where c.id = p_crew;
$$;
revoke all on function private.day_of_part(uuid) from public;

create or replace function private.notify_group_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_body text;
  v_spot text;
  v_kind public.notification_kind := 'plan_status';
  v_path text := private.crowd_path(new.gathering_id);
  v_tz text := private.gathering_tz(new.gathering_id);
  v_when text;
  r record;
  v_other_id uuid;
  v_other_crew uuid;
begin
  if new.state = old.state then
    return new;
  end if;
  if new.kind = 'solo' and new.state <> 'live' then
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
    v_when := case when extract(hour from (select g.starts_at from public.gatherings g where g.id = new.gathering_id) at time zone v_tz) >= 17
                   then 'Tonight' else 'Today' end;
    for r in
      select m.person_id from public.crew_members m join public.people p on p.id = m.person_id
      where m.crew_id = new.id and m.left_at is null and p.hidden_at is null and private.wants(m.person_id, 'day_of')
    loop
      v_other_id := null;
      v_other_crew := null;
      select n.id, n.crew_id into v_other_id, v_other_crew from public.notifications n
      where n.person_id = r.person_id and n.gathering_id = new.gathering_id and n.kind = 'day_of'
        and n.sent_at is null and n.crew_id is distinct from new.id
      limit 1;
      if v_other_id is not null then
        update public.notifications n
        set body = v_when || ': ' || (
              select string_agg(private.day_of_part(c.id), ', and ' order by c.meet_at, c.kind)
              from public.crews c where c.id in (new.id, v_other_crew)
            ) || ' — tap when you''re there',
            path = private.crowd_path(new.gathering_id)
        where n.id = v_other_id;
      else
        insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
        values (r.person_id, 'day_of', new.gathering_id, new.id, private.gathering_name(new.gathering_id),
                v_when || ': ' || case when v_spot is null and new.kind = 'crew' then 'find your group at the start'
                                       else private.day_of_part(new.id) end || ' — tap when you''re there',
                '/group/' || new.id)
        on conflict do nothing;
      end if;
    end loop;
    return new;
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

-- A withdrawn gathering tells a 1-on-1 plan in its own words.
create or replace function private.gatherings_notify_withdrawn() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.withdrawn_at is null or old.withdrawn_at is not null then
    return new;
  end if;
  insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
  select m.person_id, 'plan_status', new.id, c.id, new.name,
         -- PROPOSED copy (Tatiana's to reword).
         new.name || ' has been called off. Your ' || case when c.kind = 'solo' then '1-on-1' else 'group' end
           || ' is still here if you want to talk it over.',
         '/group/' || c.id
  from public.crews c
  join public.crew_members m on m.crew_id = c.id and m.left_at is null
  join public.people p on p.id = m.person_id
  where c.gathering_id = new.id and c.state in ('forming', 'spot_set', 'live')
    and p.hidden_at is null
    and private.wants(m.person_id, 'plan_status');
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Time: the lifecycle job, with 1-on-1 (everything else as m3_3_group_deadline_and_invite_more)
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

  -- 1-on-1 proposals vanish at the start; a withdrawn gathering's close.
  update public.solo_proposals p set status = 'expired', decided_at = now()
  from public.gatherings g
  where g.id = p.gathering_id and p.status = 'open' and now() >= g.starts_at;
  get diagnostics v_solo_expired = row_count;
  update public.solo_proposals p set status = 'closed', decided_at = coalesce(p.decided_at, now())
  from public.gatherings g
  where g.id = p.gathering_id and private.solo_pending(p.status) and g.withdrawn_at is not null;
  get diagnostics v_solo_closed = row_count;

  -- Under 3 at its deadline (the later of −6 h and started + 2 h, never after −3 h):
  -- closed. Its people are still in the room.
  update public.crews c set state = 'dissolved', dissolved_at = now()
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'forming'
    and now() >= least(greatest(g.starts_at - interval '6 hours', c.created_at + interval '2 hours'), g.starts_at - interval '3 hours')
    and private.active_members(c.id) < 3;
  get diagnostics v_dissolved = row_count;
  update public.crew_members m set left_at = now()
  from public.crews c
  where c.id = m.crew_id and c.state = 'dissolved' and m.left_at is null;
  -- A closed group's open invites lapse with it.
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
  where g.id = c.gathering_id and c.state = 'forming'
    and now() >= g.starts_at - interval '3 hours'
    and private.active_members(c.id) >= 3;
  get diagnostics v_planned = row_count;

  update public.crews c set state = 'live'
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'spot_set' and now() >= g.starts_at - interval '3 hours';
  get diagnostics v_live = row_count;

  -- A group is done at the effective end; a 1-on-1 plan at the later of that and an hour
  -- after it meets, so a meet after the end is not over before it starts.
  update public.crews c set state = 'done'
  from public.gatherings g
  where g.id = c.gathering_id and c.state in ('spot_set', 'live')
    and now() >= case when c.kind = 'solo'
                      then greatest(public.effective_end(g), c.meet_at + interval '1 hour')
                      else public.effective_end(g) end;
  get diagnostics v_done = row_count;

  return jsonb_build_object('expired', v_expired, 'dissolved', v_dissolved, 'planned', v_planned, 'live', v_live, 'done', v_done,
                            'solo_expired', v_solo_expired, 'solo_closed', v_solo_closed);
end;
$$;

-- ---------------------------------------------------------------------------
-- A16: one page for both plans, each person once; a tick on every plan you shared
-- ---------------------------------------------------------------------------

-- The finished plans (group and 1-on-1) I share with someone at a gathering, A16 still open.
create function private.after_shared(p_me uuid, p_to uuid, p_gathering uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id order by c.kind), '{}')
  from public.crews c
  where c.gathering_id = p_gathering
    and private.in_crew(p_me, c.id) and private.in_crew(p_to, c.id)
    and private.after_open(c.id);
$$;
revoke all on function private.after_shared(uuid, uuid, uuid) from public;

create or replace function public.after_tick(p_crew uuid, p_to uuid, p_kind public.confirmation_kind, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_g uuid;
  v_shared uuid[];
begin
  select gathering_id into v_g from public.crews where id = p_crew;
  if v_me is null or v_me = p_to or v_g is null
     or not private.in_crew(v_me, p_crew)
     or private.blocked_between(v_me, p_to) then
    raise exception 'refused: not in this group' using errcode = '42501';
  end if;
  if not private.after_open(p_crew) then
    raise exception 'refused: after closed' using errcode = '42501';
  end if;
  v_shared := private.after_shared(v_me, p_to, v_g);
  if cardinality(v_shared) = 0 then
    raise exception 'refused: not in this group' using errcode = '42501';
  end if;
  if p_on then
    if p_kind = 'keep_in_touch' and not exists (
      select 1 from unnest(v_shared) c
      where private.ticked(c, v_me, p_to, 'we_met') and private.ticked(c, p_to, v_me, 'we_met')
    ) then
      raise exception 'refused: we met first' using errcode = '42501';
    end if;
    insert into public.confirmations (crew_id, from_person, to_person, kind)
    select c, v_me, p_to, p_kind from unnest(v_shared) c
    on conflict do nothing;
    if p_kind = 'keep_in_touch' and exists (select 1 from unnest(v_shared) c where private.ticked(c, p_to, v_me, 'keep_in_touch')) then
      insert into public.connections (person_a, person_b, source_crew_id)
      values (least(v_me, p_to), greatest(v_me, p_to), v_shared[1])
      on conflict do nothing;
    end if;
  else
    -- Take a tick back only while it is unmatched. Taking back "we met" takes the
    -- unmatched "keep in touch" that hung on it too.
    if exists (
      select 1 from unnest(v_shared) c
      where private.ticked(c, p_to, v_me, p_kind) and private.ticked(c, v_me, p_to, p_kind)
    ) then
      raise exception 'refused: matched' using errcode = '42501';
    end if;
    delete from public.confirmations
    where crew_id = any (v_shared) and from_person = v_me and to_person = p_to
      and (kind = p_kind or (p_kind = 'we_met' and kind = 'keep_in_touch'));
  end if;
end;
$$;

create or replace function public.after_state(p_gathering uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_crews uuid[];
  v_ended boolean;
begin
  if v_me is null then return null; end if;
  select now() >= public.effective_end(g) into v_ended from public.gatherings g where g.id = p_gathering;
  select coalesce(array_agg(m.crew_id order by c.kind), '{}') into v_crews
  from public.crew_members m join public.crews c on c.id = m.crew_id
  where m.person_id = v_me and m.gathering_id = p_gathering and m.left_at is null and c.state = 'done' and c.hidden_at is null;
  return jsonb_build_object(
    'ended', coalesce(v_ended, false),
    'asked', coalesce(v_ended, false) and exists (
      select 1 from public.pins p where p.person_id = v_me and p.gathering_id = p_gathering and p.open_to_meeting),
    'answered', exists (select 1 from public.survey_responses s where s.person_id = v_me and s.gathering_id = p_gathering),
    'crew_id', v_crews[1],
    'open', exists (select 1 from unnest(v_crews) c where private.after_open(c)),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', x.id,
        'first_name', x.first_name,
        'photo_path', x.photo_path,
        'we_met', exists (select 1 from unnest(x.shared) c where private.ticked(c, v_me, x.id, 'we_met')),
        'we_met_matched', exists (select 1 from unnest(x.shared) c where private.ticked(c, v_me, x.id, 'we_met') and private.ticked(c, x.id, v_me, 'we_met')),
        'keep', exists (select 1 from unnest(x.shared) c where private.ticked(c, v_me, x.id, 'keep_in_touch')),
        'keep_matched', exists (select 1 from unnest(x.shared) c where private.ticked(c, v_me, x.id, 'keep_in_touch') and private.ticked(c, x.id, v_me, 'keep_in_touch'))
      ) order by x.joined_at)
      from (
        -- Each person once, however many plans you shared with them.
        select pe.id, pe.first_name,
               case when pe.photo_status <> 'rejected' then pe.photo_path end as photo_path,
               min(m.joined_at) as joined_at,
               array_agg(m.crew_id) as shared
        from public.crew_members m join public.people pe on pe.id = m.person_id
        where m.crew_id = any (v_crews) and m.left_at is null and m.person_id <> v_me
          and pe.hidden_at is null and not private.blocked_between(v_me, pe.id)
        group by pe.id, pe.first_name, pe.photo_status, pe.photo_path
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The per-platform switch (decisions Part 5: "a server flag per platform can switch solo
-- off, e.g. if App Review rejects it, while the web keeps it")
-- ---------------------------------------------------------------------------

create table public.app_switches (
  name        text primary key,
  ios         boolean not null default true,
  web         boolean not null default true,
  updated_at  timestamptz not null default now()
);
comment on table public.app_switches is
  'Per-platform switches the app reads (M3.4). Not a database rule: the database cannot tell which platform asks. Set by the admin.';
alter table public.app_switches enable row level security;
revoke all on public.app_switches from public, anon, authenticated;
grant select on public.app_switches to anon, authenticated;
create policy app_switches_read on public.app_switches for select to anon, authenticated using (true);
insert into public.app_switches (name) values ('solo');

create function public.admin_set_app_switch(p_name text, p_ios boolean, p_web boolean, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.app_switches set ios = p_ios, web = p_web, updated_at = now() where name = p_name;
  if not found then raise exception 'No such switch'; end if;
  insert into public.moderation_log (actor, action, note)
  values (p_actor, 'app_switch', p_name || ': ios ' || p_ios || ', web ' || p_web);
end;
$$;
revoke all on function public.admin_set_app_switch(text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_app_switch(text, boolean, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- The export: my 1-on-1 settings and proposals, as I may know them
-- ---------------------------------------------------------------------------

create function public.my_solo_export() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', coalesce((
      select jsonb_agg(jsonb_build_object('gathering_id', p.gathering_id, 'meet_1_on_1', p.solo_opt_in, 'who_can_see_you', p.solo_visibility))
      from public.pins p where p.person_id = private.me() and p.solo_opt_in
    ), '[]'::jsonb),
    'proposals_sent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gathering_id', p.gathering_id, 'spot', s.name, 'meet_at', p.meet_at, 'line', p.line, 'sent_at', p.created_at,
        -- A decline is never told to the sender, here either.
        'status', case
          when p.status in ('accepted', 'withdrawn', 'closed') then p.status::text
          when now() < g.starts_at then 'sent'
          else 'not accepted' end))
      from public.solo_proposals p
      join public.gatherings g on g.id = p.gathering_id
      join public.meeting_spots s on s.id = p.spot_id
      where p.from_person = private.me()
    ), '[]'::jsonb),
    'proposals_received', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gathering_id', p.gathering_id, 'spot', s.name, 'meet_at', p.meet_at, 'line', p.line, 'received_at', p.created_at,
        'status', p.status::text, 'answered_at', p.decided_at))
      from public.solo_proposals p
      join public.meeting_spots s on s.id = p.spot_id
      where p.to_person = private.me()
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.my_solo_export() from public, anon;
grant execute on function public.my_solo_export() to authenticated;

-- ---------------------------------------------------------------------------
-- Metrics (§7): 1-on-1 measured on its own, from day one. Groups' columns are M4.5's.
-- ---------------------------------------------------------------------------

create view private.solo_metrics_by_gathering as
select
  g.id as gathering_id,
  g.name,
  g.starts_at,
  -- Availability first: without spots there is no 1-on-1 to choose (decisions).
  private.has_spots(g.id) as has_spots,
  (select count(*) from public.pins p where p.gathering_id = g.id) as pinned,
  (select count(*) from public.pins p where p.gathering_id = g.id and p.open_to_meeting) as open_to_meeting,
  (select count(*) from public.pins p where p.gathering_id = g.id and p.solo_opt_in) as solo_opted,
  (select count(*) from public.pins p where p.gathering_id = g.id and p.solo_opt_in and p.solo_visibility = 'women_only') as solo_women_only,
  (select count(*) from public.solo_proposals p where p.gathering_id = g.id) as proposals,
  (select count(*) from public.solo_proposals p where p.gathering_id = g.id and p.status = 'accepted') as accepted,
  (select count(*) from public.solo_proposals p where p.gathering_id = g.id and p.status = 'declined') as declined,
  (select count(*) from public.solo_proposals p where p.gathering_id = g.id and p.status = 'expired') as expired,
  (select count(*) from public.solo_proposals p where p.gathering_id = g.id and p.status = 'withdrawn') as withdrawn,
  (select count(*) from public.solo_proposals p where p.gathering_id = g.id and p.status = 'closed') as closed,
  (select count(distinct p.from_person) from public.solo_proposals p where p.gathering_id = g.id) as proposers,
  (select count(*) from public.crews c where c.gathering_id = g.id and c.kind = 'solo') as plans,
  (select count(*) from public.crews c where c.gathering_id = g.id and c.kind = 'solo' and c.state = 'dissolved') as plans_dissolved,
  (select count(*) from public.crew_members m join public.crews c on c.id = m.crew_id
     where c.gathering_id = g.id and c.kind = 'solo' and c.state in ('live', 'done') and (m.left_at is null or c.state = 'done')) as plan_members,
  (select count(*) from public.crew_members m join public.crews c on c.id = m.crew_id
     where c.gathering_id = g.id and c.kind = 'solo' and m.arrived_at is not null) as arrived,
  (select count(distinct a.from_person) from public.confirmations a
     join public.confirmations b on b.crew_id = a.crew_id and b.from_person = a.to_person and b.to_person = a.from_person and b.kind = a.kind
     join public.crews c on c.id = a.crew_id
     where c.gathering_id = g.id and c.kind = 'solo' and a.kind = 'we_met') as met,
  -- Someone in a group and a 1-on-1 plan at the same gathering (cannibalisation, §7).
  (select count(distinct m.person_id) from public.crew_members m
     where m.gathering_id = g.id and m.kind = 'solo'
       and exists (select 1 from public.crew_members o where o.gathering_id = g.id and o.person_id = m.person_id and o.kind = 'crew')) as also_in_a_group
from public.gatherings g
where g.published_at is not null and not g.is_seed;

comment on view private.solo_metrics_by_gathering is
  '§7 1-on-1 columns per gathering (M3.4). Counts only — nothing names a person. Read by the admin through admin_solo_metrics; M4.5''s gathering_stats snapshots it before pins are deleted.';

create function public.admin_solo_metrics(p_from timestamptz default now() - interval '8 weeks', p_to timestamptz default now() + interval '4 weeks')
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(m) order by m.starts_at desc), '[]'::jsonb)
  from private.solo_metrics_by_gathering m where m.starts_at between p_from and p_to;
$$;
revoke all on function public.admin_solo_metrics(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_solo_metrics(timestamptz, timestamptz) to service_role;
