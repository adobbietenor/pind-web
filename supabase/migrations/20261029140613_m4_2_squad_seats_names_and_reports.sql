-- M4.2 fixes (29 Oct 2026), approved by Alex as a batch (decisions, "M4.2: the review fixes").
--
-- F5/F6 — EIGHT SEATS, ALWAYS. A squad never holds more than 8 people, +1s counted. Seats were
--   fixed at join, so a member raising their +1s in a full squad took a ninth person (RV04-F);
--   now a change to your party size changes your seats, and in a full squad it is refused
--   with a sentence. The database's own check now also fires when a membership row is moved
--   between squads (RV05-F) — no session can, but the claim was "even against the service key".
--
-- F7/F8 — THE NAME CHECK CANNOT BE RE-ROLLED OR RUN DRY. A name the check refused cannot be
--   submitted again for that squad, ignoring case and spacing (RV14-F). At most 3 renames per
--   squad a day (RV15-F: 25 in a row were accepted, each one an AI call against the daily cap
--   shared with photo checks and the import). One squad at a time still holds (the per-kind
--   index), and at most 3 squad starts per person per gathering — the start, leave, start
--   loop. start_squad also takes the person's lock, as join_squad does (20261029140204).
--
-- D3 — A SQUAD IS NOT DELISTED BY ONE REPORT (Alex, option b). A report on a squad itself
--   (its name, its spot and time) makes it disappear for the reporter at once, goes to the
--   admin queue, and delists it for everyone only at two reports from different people, or
--   by the admin. One "uncomfortable" tap used to delist any squad at any gathering — a
--   griefing tool. Members cannot report their own squad: from inside, you report a person,
--   and H9 for people is unchanged (one safety report hides a person everywhere — Alex). A
--   1-on-1 plan's reports are unchanged.

-- ---------------------------------------------------------------------------
-- F6: the check fires on a move between squads
-- ---------------------------------------------------------------------------

drop trigger crew_members_squad_eight_seats on public.crew_members;
create trigger crew_members_squad_eight_seats
  before insert or update of left_at, seats, crew_id on public.crew_members
  for each row execute function private.squad_eight_seats();

-- ---------------------------------------------------------------------------
-- F5: your party size is your seats, and a full squad has no room for a +1
-- ---------------------------------------------------------------------------

create function private.pins_party_takes_squad_seats() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_m record;
  v_new smallint := least(new.party_total, 2)::smallint;
begin
  if new.party_total is distinct from old.party_total then
    perform private.lock_people(array[new.person_id]);
    select m.id, m.crew_id, m.seats into v_m
    from public.crew_members m join public.crews c on c.id = m.crew_id
    where m.person_id = new.person_id and m.gathering_id = new.gathering_id and m.left_at is null
      and c.kind = 'crew' and not c.legacy and c.state in ('spot_set', 'live');
    if v_m.id is not null and v_new <> v_m.seats then
      perform 1 from public.crews where id = v_m.crew_id for update;
      if private.squad_seats(v_m.crew_id) - v_m.seats + v_new > 8 then
        raise exception 'Your squad is full, so there''s no seat there for a +1.'
          using errcode = 'check_violation', hint = 'squad_full_plus_one';
      end if;
      update public.crew_members set seats = v_new where id = v_m.id;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.pins_party_takes_squad_seats() from public;
create trigger pins_party_takes_squad_seats
  after update of party_total on public.pins
  for each row execute function private.pins_party_takes_squad_seats();

-- ---------------------------------------------------------------------------
-- F7/F8 and the start: caps, the refused name, the lock
-- ---------------------------------------------------------------------------

create table private.squad_renames (
  crew_id     uuid not null references public.crews (id) on delete cascade,
  renamed_at  timestamptz not null default now()
);
create index squad_renames_crew_at_idx on private.squad_renames (crew_id, renamed_at);
alter table private.squad_renames enable row level security;
revoke all on private.squad_renames from public, anon, authenticated;
comment on table private.squad_renames is
  'One row per rename of a squad (M4.2), for the cap of 3 a day. Read only by rename_squad.';

-- How two names compare for "the same name": case and spacing ignored.
create function private.squad_name_key(p_name text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;
revoke all on function private.squad_name_key(text) from public;

create or replace function public.rename_squad(p_crew uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    raise exception 'refused: a name of 1 to 40 characters' using errcode = '22023', hint = 'squad_name';
  end if;
  perform 1 from public.crews where id = p_crew for update;
  if exists (
    select 1 from public.squad_name_checks k
    where k.crew_id = p_crew and k.outcome = 'rejected' and private.squad_name_key(k.name) = private.squad_name_key(v_name)
  ) then
    raise exception 'refused: that name was not accepted before' using errcode = '22023', hint = 'squad_name_refused_before';
  end if;
  if (select count(*) from private.squad_renames r where r.crew_id = p_crew and r.renamed_at > now() - interval '24 hours') >= 3 then
    raise exception 'refused: three renames today' using errcode = '42501', hint = 'squad_rename_limit';
  end if;
  update public.crews set name = v_name, name_status = 'pending'
  where id = p_crew and created_by = private.me() and private.in_group(p_crew)
    and kind = 'crew' and not legacy and name_status in ('pending', 'rejected') and state in ('spot_set', 'live');
  if not found then
    raise exception 'refused: that name can no longer be changed' using errcode = '42501', hint = 'squad_rename';
  end if;
  insert into private.squad_renames (crew_id) values (p_crew);
end;
$$;

create or replace function public.start_squad(p_gathering uuid, p_name text, p_spot uuid, p_meet_at timestamptz, p_women_only boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_g public.gatherings;
  v_name text := btrim(coalesce(p_name, ''));
  v_women boolean;
  v_crew uuid;
begin
  -- The person's lock first: a hide, a block or the women-only switch is either already in
  -- (and refuses below) or waits for this squad and then acts on it.
  perform private.lock_people(array[v_me]);
  select * into v_g from public.gatherings where id = p_gathering;
  if v_me is null or v_g.id is null or v_g.withdrawn_at is not null
     or not private.is_open_at(v_me, p_gathering) or private.is_hidden(v_me) then
    raise exception 'refused: pin in and open to meeting first' using errcode = '42501', hint = 'squad_not_open_to_meeting';
  end if;
  if char_length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    raise exception 'refused: a name of 1 to 40 characters' using errcode = '22023', hint = 'squad_name';
  end if;
  if p_meet_at is null or not private.solo_time_ok(p_gathering, p_meet_at) then
    raise exception 'refused: not a time on offer' using errcode = '22023', hint = 'squad_time';
  end if;
  if p_spot is null then
    if private.has_spots(p_gathering) then
      raise exception 'refused: pick a meeting spot' using errcode = '22023', hint = 'squad_spot';
    end if;
  elsif not exists (select 1 from public.meeting_spots s where s.id = p_spot and s.venue_id = v_g.venue_id and s.active) then
    raise exception 'refused: not one of this venue''s spots' using errcode = '22023', hint = 'squad_spot';
  end if;
  v_women := coalesce(p_women_only, false) or private.women_only_only(v_me);
  if v_women and not private.is_women_only_eligible(v_me) then
    raise exception 'refused: not eligible for women only' using errcode = '42501', hint = 'squad_not_eligible';
  end if;
  if private.in_a_group_at(v_me, p_gathering) then
    raise exception 'refused: already in a group here' using errcode = '42501', hint = 'squad_in_group';
  end if;
  -- One at a time, and at most three starts here (F8): each start is a name check.
  if (select count(*) from public.crews c
      where c.gathering_id = p_gathering and c.created_by = v_me and c.kind = 'crew' and not c.legacy) >= 3 then
    raise exception 'refused: three squads started here' using errcode = '42501', hint = 'squad_start_limit';
  end if;
  insert into public.crews (gathering_id, kind, state, spot_id, meet_at, name, name_status, created_by, women_only)
  values (p_gathering, 'crew', 'spot_set', p_spot, p_meet_at, v_name, 'pending', v_me, v_women)
  returning id into v_crew;
  insert into public.crew_members (crew_id, gathering_id, person_id, seats)
  values (v_crew, p_gathering, v_me, private.my_seats(v_me, p_gathering));
  return v_crew;
end;
$$;

-- ---------------------------------------------------------------------------
-- D3: reports on a squad
-- ---------------------------------------------------------------------------

-- A squad you reported is gone for you at once. Otherwise as 20261015004343.
create or replace function private.can_see_squad(p_crew uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select c.kind = 'crew' and not c.legacy
       and c.state in ('spot_set', 'live')
       and c.hidden_at is null
       and c.name_status = 'approved'
       and now() < c.meet_at
       and not exists (select 1 from public.gatherings g where g.id = c.gathering_id and g.withdrawn_at is not null)
       and private.is_open_at(me.id, c.gathering_id)
       and not private.is_hidden(me.id)
       and case when c.women_only then private.is_women_only_eligible(me.id)
                else not private.women_only_only(me.id) end
       and not exists (
         select 1 from public.crew_members m
         where m.crew_id = c.id and m.left_at is null and private.blocked_between(me.id, m.person_id)
       )
       and not exists (select 1 from public.reports r where r.target_crew_id = c.id and r.reporter_id = me.id)
    from public.crews c, (select private.me() as id) me
    where c.id = p_crew and me.id is not null
  ), false);
$$;

-- Anyone it is listed to may report a squad — never its own members.
drop policy reports_insert_on_visible_squad on public.reports;
create policy reports_insert_on_visible_squad on public.reports
  for insert to authenticated with check (
    reporter_id = private.me()
    and target_kind = 'crew'
    and target_crew_id is not null
    and private.is_squad(target_crew_id)
    and private.can_see_squad(target_crew_id)
    and not private.in_group(target_crew_id)
  );

-- H9's auto-hide (as 20261016153531) with one change: a squad (kind 'crew') is delisted
-- only at two reports from different people, of any kind, never by one safety report.
-- People and 1-on-1 plans are unchanged.
create or replace function private.auto_hide_on_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  hide boolean := new.is_safety;
  v_squad boolean := new.target_crew_id is not null and private.is_squad(new.target_crew_id);
begin
  if new.target_person_id is null and new.target_crew_id is null then
    return null;
  end if;

  if v_squad then
    select count(distinct r.reporter_id) >= 2 into hide
    from public.reports r
    where r.status in ('open', 'auto_hidden') and r.target_crew_id = new.target_crew_id;
  elsif not hide then
    select count(distinct r.reporter_id) >= 2 into hide
    from public.reports r
    where r.status in ('open', 'auto_hidden')
      and not r.is_safety
      and r.target_kind = new.target_kind
      and r.target_person_id is not distinct from new.target_person_id
      and r.target_crew_id   is not distinct from new.target_crew_id;
  end if;

  if not hide then
    return null;
  end if;

  if new.target_person_id is not null then
    update public.people set hidden_at = coalesce(hidden_at, now()) where id = new.target_person_id;
    update public.reports set status = 'auto_hidden'
      where target_person_id = new.target_person_id and status = 'open';
  else
    update public.crews set hidden_at = coalesce(hidden_at, now()) where id = new.target_crew_id;
    update public.reports set status = 'auto_hidden'
      where target_crew_id = new.target_crew_id and status = 'open';
  end if;

  return null;
end;
$$;

-- The admin delists a squad, or lists it again (D3: "or by me"; and the way back from two
-- reports that were wrong). Logged, and its open reports closed with the decision.
create function public.admin_set_squad_listed(p_crew uuid, p_listed boolean, p_actor text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_squad(p_crew) then
    raise exception 'That is not a squad' using errcode = '22023';
  end if;
  update public.crews set hidden_at = case when p_listed then null else coalesce(hidden_at, now()) end where id = p_crew;
  update public.reports set status = (case when p_listed then 'dismissed' else 'actioned' end)::public.report_status, reviewed_at = now(), decision_note = p_note
  where target_crew_id = p_crew and status in ('open', 'auto_hidden');
  insert into public.moderation_log (actor, action, gathering_id, note)
  select p_actor, case when p_listed then 'squad_listed' else 'squad_delisted' end, c.gathering_id,
         coalesce(p_note, '') || ' [crew ' || p_crew::text || ']'
  from public.crews c where c.id = p_crew;
end;
$$;
revoke all on function public.admin_set_squad_listed(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_squad_listed(uuid, boolean, text, text) to service_role;
