-- M3.7 (A9, A11, A15): named squads, open to join — replacing M3.3's invite-only group
-- (Alex, 14 Oct 2026; decisions, "M3.7: named squads, open to join").
--
-- A squad is a small group (`crews`, kind 'crew') with a name its creator writes, a spot
-- and a time fixed at creation, and up to 8 seats. Anyone pinned at the gathering and open
-- to meeting can see it and join — not only people in the room, not only people they have
-- posted with. One group per person per gathering still holds (the per-kind index).
--
-- Who sees and joins what (docs/visibility.md §12m):
--   - listed (`squads`) to someone pinned there, open to meeting and not hidden, once its
--     name is approved, while it is not hidden, before its meeting time, and only if no
--     member has blocked them or been blocked by them — otherwise it is simply absent;
--   - women-only is INHERITED: a women-only squad exists only for women-only-eligible
--     people, and someone who chose "women-only rooms only" sees, makes and joins only
--     women-only squads;
--   - every "that squad is gone" refusal is one sentence, so a block never shows;
--   - inside, members only, as groups always were — and Instagram handles are no longer
--     shown in squads (share_crew narrowed to 1-on-1 plans): open join would hand seven
--     handles to anyone who taps.
--
-- States (no "forming"): spot_set (open) → live (−3 h) → done (the later of the
-- effective end and an hour after it meets), or dissolved (the last one out). A withdrawn
-- gathering does what it does for every group: members are told and the squad stays for
-- them to talk it over, off the list. The creator leaving changes nothing (Q4: no owner).
--
-- The name: checked by AI on the photos' loose standard (Worker, src/squad/), triggered by
-- this database the way photos are. Pending and rejected names are never listed.
--
-- Existing groups (all test data): forming ones dissolved silently, open invites withdrawn,
-- set and live ones run on to done unnamed and unlisted (`legacy`).

-- ---------------------------------------------------------------------------
-- The squad's columns
-- ---------------------------------------------------------------------------

create type public.squad_name_status as enum ('pending', 'approved', 'rejected');

alter table public.crews
  add column name        text,
  add column name_status public.squad_name_status,
  add column created_by  uuid references public.people (id) on delete set null,
  add column legacy      boolean not null default false,
  add constraint crews_squad_name_shape check (
    name is null or (char_length(name) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]')
  );

comment on column public.crews.name is
  'A squad''s name (M3.7), written by its creator, 1–40 characters. Listed only once name_status is approved.';
comment on column public.crews.legacy is
  'An invite-only group from M3.3, made before squads (M3.7). Unnamed, never listed, never joinable; runs on to done.';

-- The old groups.
update public.crews set legacy = true where kind = 'crew';

alter table public.crews disable trigger crews_notify_change;
update public.crews set state = 'dissolved', dissolved_at = now() where kind = 'crew' and legacy and state = 'forming';
alter table public.crews enable trigger crews_notify_change;
update public.crew_members m set left_at = now()
from public.crews c
where c.id = m.crew_id and c.legacy and c.state = 'dissolved' and m.left_at is null;
update public.crew_invites set status = 'withdrawn', decided_at = now() where status = 'sent';

alter table public.crews add constraint crews_squad_named check (
  kind = 'solo' or legacy or (name is not null and name_status is not null)
);

-- The invite-only way in is retired.
revoke execute on function public.start_group(uuid, uuid[]) from authenticated;
revoke execute on function public.invite_more(uuid, uuid[]) from authenticated;
revoke execute on function public.respond_to_invite(uuid, boolean) from authenticated;
revoke execute on function public.my_invites(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- Who sees a squad
-- ---------------------------------------------------------------------------

create function private.is_squad(p_crew uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crews c where c.id = p_crew and c.kind = 'crew' and not c.legacy);
$$;
revoke all on function private.is_squad(uuid) from public;

-- "Women-only rooms only", honoured while eligible (as place_in_room honours it).
create function private.women_only_only(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select pp.women_only_rooms from public.people_private pp where pp.person_id = p_person), false)
     and private.is_women_only_eligible(p_person);
$$;
revoke all on function private.women_only_only(uuid) from public;

create function private.can_see_squad(p_crew uuid) returns boolean
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
    from public.crews c, (select private.me() as id) me
    where c.id = p_crew and me.id is not null
  ), false);
$$;
revoke all on function private.can_see_squad(uuid) from public;
grant execute on function private.can_see_squad(uuid) to authenticated;

create function private.squad_seats(p_crew uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(m.seats), 0)::integer from public.crew_members m where m.crew_id = p_crew and m.left_at is null;
$$;
revoke all on function private.squad_seats(uuid) from public;

-- A15's list. Members are named only where the viewer could see them on the people list.
create function public.squads(p_gathering uuid)
returns table (crew_id uuid, name text, women_only boolean, spot_id uuid, spot text, meet_at timestamptz,
               seats integer, is_full boolean, members jsonb)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.women_only, c.spot_id, s.name, c.meet_at,
         private.squad_seats(c.id), private.squad_seats(c.id) >= 8,
         coalesce((
           select jsonb_agg(jsonb_build_object('person_id', p.id, 'first_name', p.first_name) order by m.joined_at)
           from public.crew_members m join public.people p on p.id = m.person_id
           where m.crew_id = c.id and m.left_at is null and private.can_see_at(m.person_id, c.gathering_id)
         ), '[]'::jsonb)
  from public.crews c
  left join public.meeting_spots s on s.id = c.spot_id
  where c.gathering_id = p_gathering
    and private.can_see_squad(c.id)
    and not private.in_group(c.id)
  order by private.squad_seats(c.id) >= 8, c.meet_at, c.created_at;
$$;
revoke all on function public.squads(uuid) from public, anon;
grant execute on function public.squads(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Making one, joining one, renaming a name that did not pass
-- ---------------------------------------------------------------------------

create function private.in_a_group_at(p_person uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.crew_members m join public.crews c on c.id = m.crew_id
    where m.person_id = p_person and m.gathering_id = p_gathering and m.left_at is null
      and m.kind = 'crew' and c.state <> 'dissolved'
  );
$$;
revoke all on function private.in_a_group_at(uuid, uuid) from public;

create function private.my_seats(p_person uuid, p_gathering uuid) returns smallint
language sql stable security definer set search_path = '' as $$
  select least(coalesce((select p.party_total from public.pins p where p.person_id = p_person and p.gathering_id = p_gathering), 1), 2)::smallint;
$$;
revoke all on function private.my_seats(uuid, uuid) from public;

create function public.start_squad(p_gathering uuid, p_name text, p_spot uuid, p_meet_at timestamptz, p_women_only boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_g public.gatherings;
  v_name text := btrim(coalesce(p_name, ''));
  v_women boolean;
  v_crew uuid;
begin
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
  insert into public.crews (gathering_id, kind, state, spot_id, meet_at, name, name_status, created_by, women_only)
  values (p_gathering, 'crew', 'spot_set', p_spot, p_meet_at, v_name, 'pending', v_me, v_women)
  returning id into v_crew;
  insert into public.crew_members (crew_id, gathering_id, person_id, seats)
  values (v_crew, p_gathering, v_me, private.my_seats(v_me, p_gathering));
  return v_crew;
end;
$$;
revoke all on function public.start_squad(uuid, text, uuid, timestamptz, boolean) from public, anon;
grant execute on function public.start_squad(uuid, text, uuid, timestamptz, boolean) to authenticated;

create function public.join_squad(p_crew uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_c public.crews;
  v_seats smallint;
begin
  -- One join at a time per squad: the eighth seat is decided once.
  select * into v_c from public.crews where id = p_crew for update;
  if v_c.id is not null and private.in_group(p_crew) then
    return p_crew;
  end if;
  if v_me is null or v_c.id is null or not private.can_see_squad(p_crew) then
    raise exception 'refused: that squad is not open any more' using errcode = '42501', hint = 'squad_closed';
  end if;
  if private.in_a_group_at(v_me, v_c.gathering_id) then
    raise exception 'refused: already in a group here' using errcode = '42501', hint = 'squad_in_group';
  end if;
  v_seats := private.my_seats(v_me, v_c.gathering_id);
  if private.squad_seats(p_crew) + v_seats > 8 then
    raise exception 'refused: that squad is not open any more' using errcode = '42501', hint = 'squad_closed';
  end if;
  insert into public.crew_members (crew_id, gathering_id, person_id, seats)
  values (p_crew, v_c.gathering_id, v_me, v_seats);
  return p_crew;
end;
$$;
revoke all on function public.join_squad(uuid) from public, anon;
grant execute on function public.join_squad(uuid) to authenticated;

-- Only while nobody else can be in it: the name has not passed, so it was never listed.
create function public.rename_squad(p_crew uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    raise exception 'refused: a name of 1 to 40 characters' using errcode = '22023', hint = 'squad_name';
  end if;
  update public.crews set name = v_name, name_status = 'pending'
  where id = p_crew and created_by = private.me() and private.in_group(p_crew)
    and kind = 'crew' and not legacy and name_status in ('pending', 'rejected') and state in ('spot_set', 'live');
  if not found then
    raise exception 'refused: that name can no longer be changed' using errcode = '42501', hint = 'squad_rename';
  end if;
end;
$$;
revoke all on function public.rename_squad(uuid, text) from public, anon;
grant execute on function public.rename_squad(uuid, text) to authenticated;

-- Eight seats, held by the database — even against the service key.
create function private.squad_eight_seats() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'crew' and new.left_at is null and private.is_squad(new.crew_id) then
    perform 1 from public.crews where id = new.crew_id for update;
    if (select coalesce(sum(m.seats), 0) from public.crew_members m
        where m.crew_id = new.crew_id and m.left_at is null and m.id <> new.id) + new.seats > 8 then
      raise exception 'a squad has 8 seats' using errcode = 'check_violation', hint = 'squad_full';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.squad_eight_seats() from public;
create trigger crew_members_squad_eight_seats
  before insert or update of left_at, seats on public.crew_members
  for each row execute function private.squad_eight_seats();

-- The last one out: dissolved, and nobody is told (there is nobody left).
create function private.squad_last_out() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'crew' and old.left_at is null and new.left_at is not null and private.is_squad(new.crew_id)
     and private.active_members(new.crew_id) = 0 then
    update public.crews set state = 'dissolved', dissolved_at = now()
    where id = new.crew_id and state in ('spot_set', 'live');
  end if;
  return new;
end;
$$;
revoke all on function private.squad_last_out() from public;
create trigger crew_members_squad_last_out
  after update of left_at on public.crew_members
  for each row execute function private.squad_last_out();

-- A hidden person leaves every squad: a group anyone can join cannot hold someone hidden.
create function private.people_hidden_leave_squads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.hidden_at is null and new.hidden_at is not null then
    update public.crew_members m set left_at = now()
    from public.crews c
    where c.id = m.crew_id and m.person_id = new.id and m.left_at is null
      and c.kind = 'crew' and not c.legacy and c.state in ('spot_set', 'live');
  end if;
  return new;
end;
$$;
revoke all on function private.people_hidden_leave_squads() from public;
create trigger people_hidden_leave_squads
  after update of hidden_at on public.people
  for each row execute function private.people_hidden_leave_squads();

-- "Women-only rooms only" switched on: out of every mixed squad, as out of the general room.
create function private.women_only_leaves_mixed_squads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.women_only_rooms and not old.women_only_rooms then
    update public.crew_members m set left_at = now()
    from public.crews c
    where c.id = m.crew_id and m.person_id = new.person_id and m.left_at is null
      and c.kind = 'crew' and not c.legacy and not c.women_only and c.state in ('spot_set', 'live');
  end if;
  return new;
end;
$$;
revoke all on function private.women_only_leaves_mixed_squads() from public;
create trigger people_private_women_only_leaves_mixed_squads
  after update of women_only_rooms on public.people_private
  for each row execute function private.women_only_leaves_mixed_squads();

-- Reporting a squad: anyone it is listed to, and its members. H9's threshold hides it.
create policy reports_insert_on_visible_squad on public.reports
  for insert to authenticated with check (
    reporter_id = private.me()
    and target_kind = 'crew'
    and target_crew_id is not null
    and private.is_squad(target_crew_id)
    and (private.can_see_squad(target_crew_id) or private.in_group(target_crew_id))
  );

-- Handles: a 1-on-1 partner and connections only (Alex, M3.7). Squads no longer share them.
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
  );
$$;
comment on function private.share_crew(uuid) is
  'V17: shares an active 1-on-1 plan with me. Squads do not count (M3.7): open join would hand every member''s handle to anyone who taps.';

-- ---------------------------------------------------------------------------
-- The name check (Worker, src/squad/)
-- ---------------------------------------------------------------------------

create table public.squad_name_checks (
  id           uuid primary key default gen_random_uuid(),
  crew_id      uuid references public.crews (id) on delete set null,
  name         text not null,
  outcome      text not null check (outcome in ('approved', 'rejected', 'failed')),
  source       text not null,
  reason       text,
  model        text,
  ai_cost_usd  numeric(10, 6) not null default 0,
  duration_ms  integer,
  error        text,
  at           timestamptz not null default now()
);
comment on table public.squad_name_checks is
  'Every attempt to check a squad name (M3.7), failures included, so "never checked" and "check failing" are countable apart. Service key only.';
alter table public.squad_name_checks enable row level security;
revoke all on public.squad_name_checks from public, anon, authenticated;
create index squad_name_checks_crew_idx on public.squad_name_checks (crew_id, at desc);

-- Fired the way the photo check is: the same Vault URL with the squad path, and the same
-- secret (one webhook secret for the database's calls to the Worker).
create function private.squad_name_webhook() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  target text;
  secret text;
begin
  if new.kind <> 'crew' or new.legacy or new.name is null or new.name_status <> 'pending' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.name is not distinct from new.name and old.name_status is not distinct from new.name_status then
    return new;
  end if;
  if exists (select 1 from public.people p where p.id = new.created_by and private.is_harness_user(p.auth_user_id)) then
    return new;
  end if;
  select btrim(decrypted_secret) into target from vault.decrypted_secrets where name = 'photo_check_url';
  select btrim(decrypted_secret) into secret from vault.decrypted_secrets where name = 'photo_check_secret';
  if target is null or position('/hooks/photo-check' in target) = 0 or secret is null or secret = '' then
    return new;
  end if;
  perform net.http_post(
    url := replace(target, '/hooks/photo-check', '/hooks/squad-name'),
    headers := jsonb_build_object('content-type', 'application/json', 'x-pind-webhook', secret),
    body := jsonb_build_object('type', tg_op, 'table', 'crews', 'record', jsonb_build_object('id', new.id)),
    timeout_milliseconds := 5000
  );
  return new;
end;
$fn$;
revoke all on function private.squad_name_webhook() from public;
create trigger crews_squad_name_webhook
  after insert or update of name, name_status on public.crews
  for each row execute function private.squad_name_webhook();

-- Recording a check: an automated check moves only a still-pending name that is still the
-- name it judged — never overrules the admin, never a name changed since.
create function public.admin_record_squad_name_check(
  p_crew uuid, p_name text, p_outcome text, p_source text, p_reason text default null, p_model text default null,
  p_cost numeric default 0, p_duration_ms integer default null, p_error text default null
) returns public.squad_name_status
language plpgsql security definer set search_path = '' as $fn$
declare applied public.squad_name_status;
begin
  insert into public.squad_name_checks (crew_id, name, outcome, source, reason, model, ai_cost_usd, duration_ms, error)
  values (p_crew, p_name, p_outcome, p_source, p_reason, p_model, coalesce(p_cost, 0), p_duration_ms, p_error);
  if p_outcome = 'failed' then
    return null;
  end if;
  update public.crews set name_status = p_outcome::public.squad_name_status
  where id = p_crew and name = p_name and name_status = 'pending'
  returning name_status into applied;
  if applied is not null then
    insert into public.moderation_log (actor, action, gathering_id, note)
    select 'ai:squad-name', 'squad_name_' || p_outcome, c.gathering_id, left(p_name || coalesce(' — ' || p_reason, ''), 500)
    from public.crews c where c.id = p_crew;
  end if;
  return applied;
end;
$fn$;
revoke all on function public.admin_record_squad_name_check(uuid, text, text, text, text, text, numeric, integer, text) from public, anon, authenticated;
grant execute on function public.admin_record_squad_name_check(uuid, text, text, text, text, text, numeric, integer, text) to service_role;

-- The sweep's question: pending names of squads that can still be listed, oldest first.
create function public.admin_squad_names_waiting(p_limit integer) returns table (crew_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name from public.crews c
  left join public.people p on p.id = c.created_by
  where c.kind = 'crew' and not c.legacy and c.name_status = 'pending'
    and c.state in ('spot_set', 'live') and now() < c.meet_at
    and not coalesce(private.is_harness_user(p.auth_user_id), false)
  order by c.created_at
  limit p_limit;
$$;
revoke all on function public.admin_squad_names_waiting(integer) from public, anon, authenticated;
grant execute on function public.admin_squad_names_waiting(integer) to service_role;

-- Counted, not silent: waiting with nothing tried, waiting with every try failed, and how
-- long the oldest has waited.
create function public.admin_squad_name_states()
returns table (never_checked bigint, check_failing bigint, oldest_waiting timestamptz, rejected_7d bigint)
language sql stable security definer set search_path = '' as $$
  with waiting as (
    select c.id, c.created_at,
           (select count(*) from public.squad_name_checks k where k.crew_id = c.id and k.name = c.name) as tries
    from public.crews c
    where c.kind = 'crew' and not c.legacy and c.name_status = 'pending' and c.state in ('spot_set', 'live') and now() < c.meet_at
  )
  select count(*) filter (where tries = 0), count(*) filter (where tries > 0), min(created_at),
         (select count(*) from public.squad_name_checks k where k.outcome = 'rejected' and k.at > now() - interval '7 days')
  from waiting;
$$;
revoke all on function public.admin_squad_name_states() from public, anon, authenticated;
grant execute on function public.admin_squad_name_states() to service_role;

-- The admin may approve a name the check refused. Logged; not a queue — nothing waits on it.
create function public.admin_approve_squad_name(p_crew uuid, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.crews set name_status = 'approved'
  where id = p_crew and kind = 'crew' and not legacy and name_status in ('pending', 'rejected');
  if not found then raise exception 'That squad''s name is not waiting or refused'; end if;
  insert into public.moderation_log (actor, action, gathering_id, note)
  select p_actor, 'squad_name_approved', c.gathering_id, c.name from public.crews c where c.id = p_crew;
end;
$$;
revoke all on function public.admin_approve_squad_name(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_approve_squad_name(uuid, text) to service_role;

-- The daily cap counts the name check too.
create or replace function public.admin_ai_spend_today(p_city text) returns numeric
language sql stable set search_path = '' as $fn$
  select
    coalesce((
      select sum(r.ai_cost_usd)
      from public.import_runs r, public.cities c
      where c.slug = p_city
        and (r.started_at at time zone c.timezone)::date = (now() at time zone c.timezone)::date
    ), 0)
    +
    coalesce((
      select sum(r.ai_cost_usd)
      from public.community_check_runs r, public.cities c
      where c.slug = p_city
        and r.city = p_city
        and (r.started_at at time zone c.timezone)::date = (now() at time zone c.timezone)::date
    ), 0)
    +
    coalesce((
      select sum(p.ai_cost_usd)
      from public.photo_checks p, public.cities c
      where c.slug = p_city
        and (p.at at time zone c.timezone)::date = (now() at time zone c.timezone)::date
    ), 0)
    +
    coalesce((
      select sum(k.ai_cost_usd)
      from public.squad_name_checks k, public.cities c
      where c.slug = p_city
        and (k.at at time zone c.timezone)::date = (now() at time zone c.timezone)::date
    ), 0);
$fn$;
comment on function public.admin_ai_spend_today(text) is
  'Every dollar of AI spend today in this city, across every job: the nightly import, the community liveness check, the photo check and the squad name check. A job whose spend is missing from here turns a hard cap into a suggestion.';

-- ---------------------------------------------------------------------------
-- The lifecycle and notifications, as M3.4's, for squads
-- ---------------------------------------------------------------------------

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
  -- A squad speaks only when it goes live (the day-of push). It is born with its plan, and
  -- it dissolves when its last person leaves — there is nobody to tell — or with the
  -- gathering, which tells through gatherings_notify_withdrawn (M3.7).
  if new.kind = 'crew' and not new.legacy and new.state <> 'live' then
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
