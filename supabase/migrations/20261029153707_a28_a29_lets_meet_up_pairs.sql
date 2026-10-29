-- A28, A29 (#17): "Let's meet up!" — connect first, pick the spot after. The rule and the
-- lifecycle approved by Alex on 29 Oct 2026 (decisions, "#17: 1-on-1 'Let's meet up!'").
--
--   An INVITE with no spot or time, under today's request rules (3 open, once per pair, only
--   to someone you can see in 1-on-1, before the start).
--   Accepted, it is a PAIR, not a plan: a 1-on-1 group in `forming`, with no spot and no
--   time (the database already holds forming to neither).
--     * Who knows it exists: only the two. Nobody else sees it, counts it or lists it.
--     * The chat: only the two read and write it; report, block and hide as a plan's chat.
--       A block or a hide ends the pair for both; either can leave; the other sees it
--       ended, never why.
--     * What each sees of the other: what the 1-on-1 list already shows. NO INSTAGRAM until
--       it is a plan (share_crew), never gender or date of birth.
--     * The spot: either suggests one of the venue's curated spots and a time in today's
--       window; only the other's confirmation makes it a PLAN (spot_set). No spot, no plan:
--       no "I'm here", no day-of. A spot must be chosen before it is a plan (Alex: meetings
--       happen only at curated public spots — the guardrail and the App Review answer).
--     * At the start it can no longer become a plan (rule b: as a proposal expires). Its
--       chat follows Q11 like every chat (rule 2): writable to the read-only day, read-only
--       30 days after.
--     * It counts as your one 1-on-1 there (rule e): off everyone else's 1-on-1 list, and no
--       other request sent or accepted.
--     * The brake, pulled, ENDS every pair (rule 1): it exists to stop one-to-one contact.
--     * No new notification kind (rule d): "they said yes" and "the plan is made" are #3,
--       plan status.
--   A request sent with a spot and a time (an older app build) still makes a plan on
--   accept, as before.

-- ---------------------------------------------------------------------------
-- The request: spot and time together, or neither; the line optional
-- ---------------------------------------------------------------------------

alter table public.solo_proposals alter column spot_id drop not null;
alter table public.solo_proposals alter column meet_at drop not null;
alter table public.solo_proposals alter column line drop not null;
alter table public.solo_proposals add constraint solo_proposals_spot_and_time_together
  check ((spot_id is null) = (meet_at is null));

-- A 1-on-1 group with no spot is a pair (forming) or one that ended.
alter table public.crews drop constraint crews_solo_has_spot;
alter table public.crews add constraint crews_solo_has_spot
  check (kind = 'crew' or state in ('dissolved', 'forming') or spot_id is not null);

create or replace function public.propose_solo(p_gathering uuid, p_to uuid, p_spot uuid, p_meet_at timestamptz, p_line smallint) returns uuid
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
  -- "Let's meet up!" sends neither; an older build sends both, checked as before.
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
    -- They asked you at the same moment.
    raise exception 'refused: already asked' using errcode = '42501';
  end;
  return v_id;
end;
$$;

-- Accepting: a pair when the request named no spot, a plan when it did. The locks and the
-- checks as 20261029140204.
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
  -- What sending checked, checked again now; the same words whatever changed (R59).
  if exists (select 1 from public.gatherings g where g.id = v_p.gathering_id and now() >= g.starts_at)
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
    -- Either of them made another 1-on-1 here at the same moment.
    raise exception 'refused: that proposal is no longer open' using errcode = '42501';
  end;
  update public.solo_proposals set status = 'accepted', decided_at = now(), crew_id = v_crew where id = p_proposal;
  -- One 1-on-1 per person per gathering: everything else pending for either closes.
  perform private.close_solo_proposals(v_p.gathering_id, v_p.from_person);
  perform private.close_solo_proposals(v_p.gathering_id, v_p.to_person);
  return v_crew;
end;
$$;

-- Rule e: a pair counts as your one 1-on-1 (can_see_solo reads this).
create or replace function private.in_solo_plan(p_person uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.crew_members m join public.crews c on c.id = m.crew_id
    where m.person_id = p_person and m.gathering_id = p_gathering and m.kind = 'solo' and m.left_at is null
      and c.state in ('forming', 'spot_set', 'live', 'done')
  );
$$;

-- Rule c: Instagram only once it is a plan — never in a pair (V17).
create or replace function private.share_crew(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.crew_members mine
    join public.crew_members theirs on theirs.crew_id = mine.crew_id
    join public.crews c on c.id = mine.crew_id
    where mine.person_id = private.me()
      and mine.left_at is null
      and theirs.person_id = p_target
      and theirs.left_at is null
      and c.hidden_at is null
      and c.kind = 'solo'
      and c.state in ('spot_set', 'live', 'done')
  );
$$;

-- The lists: a request with no spot is listed too (the spot columns are null).
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
    and now() < g.starts_at
    and not private.blocked_between(p.from_person, p.to_person)
    and (
      (p.to_person = private.me() and p.status = 'open' and private.can_see_solo(p.from_person, p.gathering_id))
      or (p.from_person = private.me() and private.solo_pending(p.status))
    )
  order by p.created_at;
$$;

-- ---------------------------------------------------------------------------
-- The spot: suggested by either, confirmed by the other
-- ---------------------------------------------------------------------------

create table public.solo_spot_suggestions (
  crew_id       uuid primary key references public.crews (id) on delete cascade,
  spot_id       uuid not null references public.meeting_spots (id) on delete restrict,
  meet_at       timestamptz not null,
  suggested_by  uuid not null references public.people (id) on delete cascade,
  created_at    timestamptz not null default now()
);
alter table public.solo_spot_suggestions enable row level security;
revoke all on public.solo_spot_suggestions from public, anon, authenticated;
grant select on public.solo_spot_suggestions to authenticated;
-- The pair's two, and nobody else (a pair is nobody else's to know about).
create policy solo_spot_suggestions_read_pair on public.solo_spot_suggestions
  for select to authenticated using (private.in_group(crew_id));
comment on table public.solo_spot_suggestions is
  'A pair''s one pending spot and time (#17, A29): suggested by either, made a plan only by the other''s confirmation. Read by the pair''s two only; written only by suggest_solo_spot.';

-- The export, now that the suggestions exist to read (as 20261029140447, with requests that name no spot, and the suggestions).
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
        -- A decline is never told to the sender, here either.
        'status', case
          when p.status in ('accepted', 'withdrawn', 'closed') then p.status::text
          when now() < g.starts_at then 'sent'
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
    -- Spots suggested in your pairs (yours, and the ones you were asked to confirm).
    'spot_suggestions', coalesce((
      select jsonb_agg(jsonb_build_object('crew_id', x.crew_id, 'spot', s.name, 'meet_at', x.meet_at, 'by_you', x.suggested_by = private.me(), 'at', x.created_at))
      from public.solo_spot_suggestions x
      join public.meeting_spots s on s.id = x.spot_id
      where private.in_crew(private.me(), x.crew_id)
    ), '[]'::jsonb)
  );
$$;

-- Is this a pair I am in, at a gathering that has not started?
create function private.my_open_pair(p_crew uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.gathering_id from public.crews c join public.gatherings g on g.id = c.gathering_id
  where c.id = p_crew and c.kind = 'solo' and c.state = 'forming' and c.hidden_at is null
    and now() < g.starts_at and private.in_group(p_crew);
$$;
revoke all on function private.my_open_pair(uuid) from public;

create function public.suggest_solo_spot(p_crew uuid, p_spot uuid, p_meet_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_g uuid;
begin
  perform private.lock_people(array[v_me]);
  v_g := private.my_open_pair(p_crew);
  if v_me is null or v_g is null then
    raise exception 'refused: that pair is not open' using errcode = '42501', hint = 'pair_closed';
  end if;
  if not exists (
    select 1 from public.gatherings g join public.meeting_spots s on s.venue_id = g.venue_id
    where g.id = v_g and s.id = p_spot and s.active
  ) then
    raise exception 'refused: not one of this venue''s spots' using errcode = '22023', hint = 'pair_spot';
  end if;
  if p_meet_at is null or not private.solo_time_ok(v_g, p_meet_at) then
    raise exception 'refused: not one of the times on offer' using errcode = '22023', hint = 'pair_time';
  end if;
  -- One pending suggestion a pair; a new one replaces it, whoever makes it.
  insert into public.solo_spot_suggestions (crew_id, spot_id, meet_at, suggested_by)
  values (p_crew, p_spot, p_meet_at, v_me)
  on conflict (crew_id) do update set spot_id = excluded.spot_id, meet_at = excluded.meet_at,
    suggested_by = excluded.suggested_by, created_at = now();
end;
$$;
revoke all on function public.suggest_solo_spot(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.suggest_solo_spot(uuid, uuid, timestamptz) to authenticated;

-- Only the other person's confirmation makes it a plan. Checked again now, with both
-- people's locks (a block racing the confirm, as R6).
create function public.confirm_solo_spot(p_crew uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_other uuid;
  v_s public.solo_spot_suggestions;
  v_g uuid;
begin
  select m.person_id into v_other from public.crew_members m
  where m.crew_id = p_crew and m.left_at is null and m.person_id <> v_me limit 1;
  perform private.lock_people(array[v_me, v_other]);
  v_g := private.my_open_pair(p_crew);
  select * into v_s from public.solo_spot_suggestions where crew_id = p_crew for update;
  if v_me is null or v_g is null or v_other is null or v_s.crew_id is null then
    raise exception 'refused: that pair is not open' using errcode = '42501', hint = 'pair_closed';
  end if;
  if v_s.suggested_by = v_me then
    raise exception 'refused: the other person confirms' using errcode = '42501', hint = 'pair_own_suggestion';
  end if;
  if private.blocked_between(v_me, v_other)
     or not exists (select 1 from public.meeting_spots s where s.id = v_s.spot_id and s.active)
     or not private.solo_time_ok(v_g, v_s.meet_at) then
    raise exception 'refused: that spot is no longer on offer' using errcode = '42501', hint = 'pair_stale';
  end if;
  update public.crews set state = 'spot_set', spot_id = v_s.spot_id, meet_at = v_s.meet_at
  where id = p_crew and state = 'forming';
  delete from public.solo_spot_suggestions where crew_id = p_crew;
  -- #3, plan status (rule d: no new kind): the one who suggested hears it is made.
  insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
  select v_s.suggested_by, 'plan_status', v_g, p_crew, private.gathering_name(v_g),
         -- PROPOSED copy (Tatiana's to reword).
         me.first_name || ' said yes: you''re meeting at ' || s.name || ', '
           || to_char(v_s.meet_at at time zone private.gathering_tz(v_g), 'FMHH12:MI am') || '.',
         '/group/' || p_crew
  from public.people me, public.meeting_spots s, public.people sb
  where me.id = v_me and s.id = v_s.spot_id and sb.id = v_s.suggested_by and sb.hidden_at is null
    and private.wants(v_s.suggested_by, 'plan_status');
end;
$$;
revoke all on function public.confirm_solo_spot(uuid) from public, anon;
grant execute on function public.confirm_solo_spot(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- #3 on accept: a plan names its spot (as before); a pair says to say hi and pick one.
-- ---------------------------------------------------------------------------

create or replace function private.notify_solo_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := private.gathering_tz(new.gathering_id);
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (person_id, kind, gathering_id, solo_proposal_id, title, body, path)
    select new.to_person, 'solo_proposal', new.gathering_id, new.id, private.gathering_name(new.gathering_id),
           -- PROPOSED copy (Tatiana's to reword).
           f.first_name || case when new.spot_id is null then ' wants to meet up at ' else ' asked to meet you 1-on-1 at ' end
             || private.gathering_name(new.gathering_id),
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
           t.first_name || ' said yes. Say hi, and pick a spot together.',
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
-- Rule 1: the brake, pulled, ends every pair (plans stand, as before).
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_solo_brake(p_pulled boolean, p_actor text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_dropped integer;
  v_pairs integer := 0;
  r record;
begin
  update private.solo_brake
  set pulled = p_pulled,
      pulled_at = case when p_pulled then now() else pulled_at end,
      changed_at = now()
  where id;
  v_dropped := private.drop_braked_solo_notifications();
  if p_pulled then
    for r in select c.id from public.crews c where c.kind = 'solo' and c.state = 'forming' loop
      perform private.dissolve_solo(r.id, true);
      v_pairs := v_pairs + 1;
    end loop;
  end if;
  insert into public.moderation_log (actor, action, note)
  values (p_actor, case when p_pulled then 'solo_brake_pulled' else 'solo_brake_lifted' end,
          v_dropped || ' proposal notification(s) dropped' || case when p_pulled then ', ' || v_pairs || ' pair(s) ended' else '' end);
  return v_dropped;
end;
$$;

-- ---------------------------------------------------------------------------
-- A pair ends as a plan does — a leave, a block or a hide dissolves it and tells the other
-- (dissolve_solo, people_solo_follows_hide: forming added) — and the lifecycle tick's rules
-- for M3.3's forming groups (closed under 3 at the deadline, planned at 3) are for squads'
-- kind only: they would have closed every pair, two people, hours before the start.
-- (Each as its latest migration, with those conditions changed.)
-- ---------------------------------------------------------------------------

create or replace function private.dissolve_solo(p_crew uuid, p_tell_hidden boolean, p_except uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_g uuid;
begin
  update public.crews set state = 'dissolved', dissolved_at = now()
  where id = p_crew and kind = 'solo' and state in ('forming', 'spot_set', 'live')
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

create or replace function private.people_solo_follows_hide() returns trigger
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
      where m.person_id = new.id and m.kind = 'solo' and m.left_at is null and c.state in ('forming', 'spot_set', 'live')
    loop
      perform private.dissolve_solo(r.crew_id, true);
    end loop;
  end if;
  return new;
end;
$$;

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
  where g.id = p.gathering_id and p.status in ('open', 'declined') and now() >= g.starts_at;
  get diagnostics v_solo_expired = row_count;
  update public.solo_proposals p set status = 'closed', decided_at = coalesce(p.decided_at, now())
  from public.gatherings g
  where g.id = p.gathering_id and private.solo_pending(p.status) and g.withdrawn_at is not null;
  get diagnostics v_solo_closed = row_count;

  -- Under 3 at its deadline (the later of −6 h and started + 2 h, never after −3 h):
  -- closed. Its people are still in the room.
  update public.crews c set state = 'dissolved', dissolved_at = now()
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'forming' and c.kind = 'crew'
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
  where g.id = c.gathering_id and c.state = 'forming' and c.kind = 'crew'
    and now() >= g.starts_at - interval '3 hours'
    and private.active_members(c.id) >= 3;
  get diagnostics v_planned = row_count;

  update public.crews c set state = 'live'
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'spot_set' and now() >= g.starts_at - interval '3 hours';
  get diagnostics v_live = row_count;

  -- A group is done at the effective end; a 1-on-1 plan or a squad at the later of that and
  -- an hour after it meets, so a meet after the end is not over before it starts (M3.7).
  update public.crews c set state = 'done'
  from public.gatherings g
  where g.id = c.gathering_id and c.state in ('spot_set', 'live')
    and now() >= case when c.kind = 'solo' or not c.legacy
                      then greatest(public.effective_end(g), c.meet_at + interval '1 hour')
                      else public.effective_end(g) end;
  get diagnostics v_done = row_count;

  return jsonb_build_object('expired', v_expired, 'dissolved', v_dissolved, 'planned', v_planned, 'live', v_live, 'done', v_done,
                            'solo_expired', v_solo_expired, 'solo_closed', v_solo_closed);
end;
$$;
