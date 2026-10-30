-- A28 / A29 / A20 — 1-on-1 since UI pass 1 (Alex, 30 Oct 2026, group 2 A with calls a, b,
-- c and decision 1).
--
-- The rule, in plain English (approved before this was written):
--   * One switch, on your account: "Open to 1-on-1 chats" (off by default), with a second
--     line for who can see you in 1-on-1, everyone or women only (call b). It applies at
--     every gathering where you are open to meeting. The A28 sheet is a shortcut to it.
--   * Who sees that you're open to 1-on-1, and can send you a request: exactly today's rule,
--     can_see_solo (both open to meeting there, both switched on, neither hidden or blocked,
--     each other's audience allows it, the brake not pulled, nobody already in a 1-on-1
--     there). Only where it reads the switch has changed: the account, not the pin.
--   * The request, the accept, "Not now" (silent: the sender keeps seeing "Request sent"),
--     3 open at most, one per pair ever, only before the start: all unchanged.
--   * Accepted, it is a chat for the two of them, as a pair was. Either of them can add a
--     place and a time at any point; **nobody confirms**. The place is one of the venue's
--     curated spots or the event itself (H5 stands: never typed); the time is words.
--   * **Their Instagram handles show to each other once a place is set** (call c), as they
--     did once a plan was made. Taking the place away hides them again.
--   * Switching the account switch off closes every request still waiting, sent or
--     received, as switching it off on a pin always did. A chat already open stays.
--
-- The older per-pin switch (pins.solo_opt_in): anyone who had it on at an upcoming gathering
-- starts with the account switch on, with that pin's audience, and every pin flag is then
-- cleared. It stays readable as a narrower override (one gathering, never wider than the
-- rule) for app builds already installed and for the harness's older cases; the app writes
-- only the account switch, and switching the account off clears any pin flag too.

alter table public.people_private
  add column one_on_one boolean not null default false,
  add column one_on_one_audience public.solo_visibility not null default 'everyone';
comment on column public.people_private.one_on_one is
  'UI pass 1: "Open to 1-on-1 chats", account-wide; read by private.solo_choice wherever the person is open to meeting.';

update public.people_private pp set one_on_one = true, one_on_one_audience = x.vis
from (
  select distinct on (pi.person_id) pi.person_id, pi.solo_visibility as vis
  from public.pins pi join public.gatherings g on g.id = pi.gathering_id
  where pi.solo_opt_in and now() < public.effective_end(g)
  order by pi.person_id, g.starts_at
) x
where x.person_id = pp.person_id;

-- Cleared without the close-on-switch-off trigger: moving the switch must not close a
-- request anyone is waiting on.
alter table public.pins disable trigger pins_solo_closes_proposals;
update public.pins set solo_opt_in = false where solo_opt_in;
alter table public.pins enable trigger pins_solo_closes_proposals;

-- The one place the switch is read (can_see_solo, propose_solo and the rest all ask this).
create or replace function private.solo_choice(p_person uuid, p_gathering uuid) returns public.solo_visibility
language sql stable security definer set search_path = '' as $$
  select case
           when pp.one_on_one and pi.open_to_meeting then pp.one_on_one_audience
           when pi.solo_opt_in then pi.solo_visibility
         end
  from public.pins pi
  left join public.people_private pp on pp.person_id = pi.person_id
  where pi.person_id = p_person and pi.gathering_id = p_gathering;
$$;

create function public.my_one_on_one() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('on', coalesce(pp.one_on_one, false), 'audience', coalesce(pp.one_on_one_audience, 'everyone'))
  from (select private.me() as id) me
  left join public.people_private pp on pp.person_id = me.id
  where me.id is not null;
$$;

create function public.set_one_on_one(p_on boolean, p_audience public.solo_visibility) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_was public.people_private;
  r record;
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  select * into v_was from public.people_private where person_id = v_me for update;
  if v_was.person_id is null then
    raise exception 'refused: set up your profile first' using errcode = '42501', hint = 'one_on_one_profile';
  end if;
  update public.people_private set one_on_one = coalesce(p_on, false), one_on_one_audience = coalesce(p_audience, 'everyone')
  where person_id = v_me;
  -- Off: every request still waiting closes, at every gathering, as the pin switch did, and
  -- no older pin flag keeps you on anywhere.
  if not coalesce(p_on, false) then
    update public.pins set solo_opt_in = false where person_id = v_me and solo_opt_in;
  end if;
  if v_was.one_on_one and not coalesce(p_on, false) then
    for r in select distinct p.gathering_id from public.solo_proposals p
             where private.solo_pending(p.status) and v_me in (p.from_person, p.to_person) loop
      perform private.close_solo_proposals(r.gathering_id, v_me);
    end loop;
  -- Narrowed to women only: requests with someone that rules out close.
  elsif coalesce(p_audience, 'everyone') = 'women_only' and v_was.one_on_one_audience <> 'women_only' then
    update public.solo_proposals p set status = 'closed', decided_at = coalesce(p.decided_at, now())
    where private.solo_pending(p.status) and v_me in (p.from_person, p.to_person)
      and not private.is_women_only_eligible(case when p.from_person = v_me then p.to_person else p.from_person end);
  end if;
end;
$$;
revoke all on function public.my_one_on_one(), public.set_one_on_one(boolean, public.solo_visibility) from public, anon;
grant execute on function public.my_one_on_one(), public.set_one_on_one(boolean, public.solo_visibility) to authenticated;

-- ---------------------------------------------------------------------------
-- The chat's place and time: either of the two, any time, nobody confirms
-- ---------------------------------------------------------------------------

alter table public.crews add column at_event boolean not null default false;
comment on column public.crews.at_event is 'A 1-on-1 whose place is the event itself (UI pass 1): a place is set, with no curated spot.';
alter table public.crews drop constraint crews_solo_has_spot;
alter table public.crews add constraint crews_solo_has_spot
  check (kind = 'crew' or state in ('dissolved', 'forming') or spot_id is not null or at_event);

create function public.set_solo_place(p_crew uuid, p_spot uuid, p_at_event boolean, p_time_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_c public.crews;
  v_g public.gatherings;
  v_time text := nullif(btrim(coalesce(p_time_note, '')), '');
  v_placed boolean;
begin
  select * into v_c from public.crews where id = p_crew for update;
  if v_me is null or v_c.id is null or v_c.kind <> 'solo' or v_c.hidden_at is not null
     or v_c.state not in ('forming', 'spot_set', 'live')
     or not exists (select 1 from public.crew_members m where m.crew_id = p_crew and m.person_id = v_me and m.left_at is null) then
    raise exception 'refused: not your 1-on-1' using errcode = '42501', hint = 'solo_not_member';
  end if;
  select * into v_g from public.gatherings where id = v_c.gathering_id;
  if now() >= public.effective_end(v_g) then
    raise exception 'refused: the event is over' using errcode = '42501', hint = 'solo_over';
  end if;
  if p_spot is not null and not exists (
    select 1 from public.meeting_spots s where s.id = p_spot and s.venue_id = v_g.venue_id and s.active
  ) then
    raise exception 'refused: not one of this venue''s spots' using errcode = '22023', hint = 'solo_spot';
  end if;
  if v_time is not null and (char_length(v_time) > 40 or v_time ~ '[[:cntrl:]]') then
    raise exception 'refused: a time of up to 40 characters' using errcode = '22023', hint = 'solo_time_note';
  end if;
  v_placed := p_spot is not null or coalesce(p_at_event, false);
  update public.crews set
    spot_id = p_spot,
    at_event = (p_spot is null and coalesce(p_at_event, false)),
    time_note = v_time,
    -- A place makes it the plan it always was (and shows the handles, share_crew); taking
    -- the place away before the night makes it a chat again. On the night it stays live.
    state = case
      when v_placed and state = 'forming' then 'spot_set'::public.crew_state
      when not v_placed and state = 'spot_set' then 'forming'::public.crew_state
      else state end,
    meet_at = case
      when v_placed and state = 'forming' then v_g.starts_at
      when not v_placed and state = 'spot_set' then null
      else meet_at end
  where id = p_crew;
  if not v_placed and v_c.state = 'live' then
    raise exception 'refused: on the night the place stays' using errcode = '42501', hint = 'solo_place_live';
  end if;
end;
$$;
revoke all on function public.set_solo_place(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_solo_place(uuid, uuid, boolean, text) to authenticated;

-- Requests waiting for me, at any gathering not yet started: A20's "Requests".
create function public.my_solo_requests() returns table (
  proposal_id uuid, gathering_id uuid, gathering_name text, gathering_slug text, starts_at timestamptz,
  person_id uuid, first_name text, photo_path text, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select p.id, g.id, g.name, g.slug, g.starts_at, o.id, o.first_name,
         case when o.photo_path is not null and private.can_see_photo(o.photo_path) then o.photo_path end, p.created_at
  from public.solo_proposals p
  join public.gatherings g on g.id = p.gathering_id
  join public.people o on o.id = p.from_person
  where p.to_person = private.me() and p.status = 'open' and now() < g.starts_at
    and not private.blocked_between(p.from_person, p.to_person)
    and private.can_see_solo(p.from_person, p.gathering_id)
  order by p.created_at;
$$;
revoke all on function public.my_solo_requests() from public, anon;
grant execute on function public.my_solo_requests() to authenticated;
