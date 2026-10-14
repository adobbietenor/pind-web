-- M3.4 — who can see whom in 1-on-1 (A28, A29). Approved by Alex, 14 Oct 2026
-- (decisions, "M3.4: who can see whom in 1-on-1").
--
-- You see someone in 1-on-1 at a gathering only when all of these hold, read at the moment:
--   * you can see each other on that gathering's people list (`can_see_at`): both open to
--     meeting, the gathering live, neither hidden, no block either way. Solo only ever
--     narrows that rule;
--   * both of you have "Meet 1-on-1" on there;
--   * neither of you is out of 1-on-1 because of a report (`people.hidden_from_solo`);
--   * the women-only limit, both ways: someone who chose "women only" sees, and is seen by,
--     only women and nonbinary people who opted into women-only.
-- 1-on-1 requires the meeting opt-in: switching meeting off switches 1-on-1 off.
--
-- Who reads what: your solo switch and your choice are readable only by you (my_solo)
-- and the admin, never through the pins table; whether someone is out of 1-on-1, only the
-- admin. Any report on a person, for any reason, takes them out at once, silently. The
-- admin returns them after review (admin_return_to_solo), a decision of its own, separate
-- from Unhide and Dismiss.
--
-- Proposals and the plan are a later migration, after the lifecycle is approved.

create type public.solo_visibility as enum ('everyone', 'women_only');

alter table public.pins
  add column solo_opt_in boolean not null default false,
  add column solo_visibility public.solo_visibility,
  add constraint pins_solo_needs_meeting check (not solo_opt_in or open_to_meeting),
  -- The forced choice (A28): on means a choice was made; off keeps none.
  add constraint pins_solo_visibility_chosen check (solo_opt_in = (solo_visibility is not null));

comment on column public.pins.solo_opt_in is
  'Meet 1-on-1 (A28, M3.4). Off by default; needs open_to_meeting. Readable only by its owner (my_solo) and the admin.';
comment on column public.pins.solo_visibility is
  'Who can see you in 1-on-1 (A28): everyone who opted in, or women only — both ways. Null while off.';

-- Switching meeting off switches 1-on-1 off; switching 1-on-1 off forgets the choice, so
-- turning it on again asks again.
create function private.pins_solo_follows_meeting() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not new.open_to_meeting or not new.solo_opt_in then
    new.solo_opt_in := false;
    new.solo_visibility := null;
  end if;
  return new;
end;
$$;
revoke all on function private.pins_solo_follows_meeting() from public;

create trigger pins_solo_follows_meeting
  before insert or update on public.pins
  for each row execute function private.pins_solo_follows_meeting();

-- Written by the owner through pins_update_own (their own pin, pinning open, and the
-- opt-in gate through open_to_meeting). Never on insert: it is off by default. Not added
-- to the select grant (Q37): nobody else reads these columns.
grant update (solo_opt_in, solo_visibility) on public.pins to authenticated;

-- Q43 (withdrawn pins are frozen) gains 1-on-1: switching it on for a gathering that is
-- no longer on Pin'd is refused, like switching meeting on. Switching off stays allowed.
create or replace function private.pins_frozen_when_unpublished() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and not private.is_published(new.gathering_id)
     and (new.party_total is distinct from old.party_total
          or (new.open_to_meeting and not old.open_to_meeting)
          or (new.solo_opt_in and not old.solo_opt_in))
  then
    raise exception 'This gathering is no longer on Pin''d, so your pin cannot change — you can still remove it.'
      using errcode = 'check_violation', hint = 'q43_pin_frozen';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Out of 1-on-1 on any report
-- ---------------------------------------------------------------------------

alter table public.people add column hidden_from_solo boolean not null default false;
comment on column public.people.hidden_from_solo is
  'Out of every 1-on-1 list (M3.4): set by any report on the person, whatever its reason; cleared only by admin_return_to_solo after review. Admin-only.';

-- A report on a person, or on one of their messages (a crew thread's or a room's), is a
-- report on that person. A report on a group names no one person and moves nothing here.
create function private.report_takes_out_of_solo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_person uuid := coalesce(
    new.target_person_id,
    (select m.author_id from public.crew_messages m where m.id = new.target_message_id),
    (select m.author_id from public.room_messages m where m.id = new.target_room_message_id)
  );
begin
  if v_person is not null then
    update public.people set hidden_from_solo = true where id = v_person and not hidden_from_solo;
  end if;
  return null;
end;
$$;
revoke all on function private.report_takes_out_of_solo() from public;

create trigger reports_take_out_of_solo after insert on public.reports
  for each row execute function private.report_takes_out_of_solo();

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

-- A person's 1-on-1 choice at a gathering: null when off (or no pin).
create function private.solo_choice(p_person uuid, p_gathering uuid) returns public.solo_visibility
language sql stable security definer set search_path = '' as $$
  select pi.solo_visibility from public.pins pi
  where pi.person_id = p_person and pi.gathering_id = p_gathering and pi.solo_opt_in;
$$;
revoke all on function private.solo_choice(uuid, uuid) from public;

create function private.can_see_solo(p_target uuid, p_gathering uuid) returns boolean
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
    from (select private.me() as id) me
    cross join lateral (select private.solo_choice(me.id, p_gathering) as mine) a
    cross join lateral (select private.solo_choice(p_target, p_gathering) as theirs) b
    where me.id is not null
  ), false);
$$;
revoke all on function private.can_see_solo(uuid, uuid) from public;
grant execute on function private.can_see_solo(uuid, uuid) to authenticated;

-- The 1-on-1 section (A29): the people the rule lets you see. Their cards (name, photo,
-- tags) are then read through the tables' own policies, as the people list is.
create function public.solo_people(p_gathering uuid)
returns table (person_id uuid, party_total smallint)
language sql stable security definer set search_path = '' as $$
  select pi.person_id, pi.party_total
  from public.pins pi
  where pi.gathering_id = p_gathering
    and pi.solo_opt_in
    and private.can_see_solo(pi.person_id, p_gathering);
$$;
revoke all on function public.solo_people(uuid) from public, anon;
grant execute on function public.solo_people(uuid) to authenticated;

-- Your own switch: null when off. The only way anyone reads it.
create function public.my_solo(p_gathering uuid) returns public.solo_visibility
language sql stable security definer set search_path = '' as $$
  select private.solo_choice(private.me(), p_gathering);
$$;
revoke all on function public.my_solo(uuid) from public, anon;
grant execute on function public.my_solo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The way back (Alex: "a single bad report must not be a one-way door")
-- ---------------------------------------------------------------------------

create function public.admin_return_to_solo(p_person uuid, p_actor text, p_note text default null) returns void
language plpgsql set search_path = '' as $$
begin
  update public.people set hidden_from_solo = false where id = p_person and hidden_from_solo;
  if not found then raise exception 'That person is not out of 1-on-1'; end if;
  insert into public.moderation_log (actor, action, person_id, note) values (p_actor, 'return_to_solo', p_person, p_note);
end;
$$;
revoke all on function public.admin_return_to_solo(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_return_to_solo(uuid, text, text) to service_role;
