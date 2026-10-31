-- A9 / A27 / A28 — 1-on-1 is per event again, switched on from the crowd page (UI pass 1,
-- round 3, item 10; Alex, 30 Oct 2026: reverses call a). The account-wide switch lived in
-- Settings; Tati had it off without knowing, which is exactly the failure.
--
-- The rule, in plain English (explained to and approved by Alex before this was written):
--   * One switch per event, "Open to 1-on-1 chats at this event", with who can see you for
--     1-on-1 (everyone or women only) as its second line. It is the existing per-pin flag
--     (pins.solo_opt_in / solo_visibility). The account switch no longer counts anywhere.
--   * Who can see you're open to 1-on-1 at X, and send you a request there: exactly
--     can_see_solo as before. Only where it reads the switch changes: your pin at X. Being on
--     at X shows nothing at Y. This only narrows: nobody becomes visible who wasn't.
--   * Switching on needs you open to meeting at X (refused otherwise, set_event_one_on_one);
--     leaving "Open to meeting" turns it off (pins_solo_follows_meeting); an unpublished
--     gathering refuses it (Q43); women only still needs eligibility.
--   * Switching off at X closes the requests still waiting at X, sent or received, and only
--     there (pins_solo_closes_proposals). An open 1-on-1 chat stays.
--   * The move: anyone with the account switch on gets the per-event switch on, with their
--     audience, at every upcoming published event they're already open to meeting at (women
--     only only where they still qualify; otherwise everyone). Nothing turns on for an event
--     they open to later. No request waiting is closed by the move.
--   * Build 20 still has the account switch in Settings (Alex: until the next build it turns
--     the per-event switch on or off at every upcoming event where you're open to meeting):
--     set_one_on_one and my_one_on_one become that, over the per-event switches.

-- The move. Turning on closes nothing (the close trigger acts on off and on narrowing only,
-- and these pins were off), and runs as the migration, so Q43's freeze does not apply; the
-- published filter keeps it from turning on where the app could not.
update public.pins pi set
  solo_opt_in = true,
  solo_visibility = case
    when pp.one_on_one_audience = 'women_only' and private.is_women_only_eligible(pi.person_id) then 'women_only'::public.solo_visibility
    else 'everyone'::public.solo_visibility end
from public.people_private pp, public.gatherings g
where pp.person_id = pi.person_id and g.id = pi.gathering_id
  and pp.one_on_one and pi.open_to_meeting and not pi.solo_opt_in
  and private.is_published(g.id) and now() < public.effective_end(g);

-- The account switch is retired: kept as a column, read by nothing, and cleared so no
-- stale "on" can be taken for a choice later.
update public.people_private set one_on_one = false where one_on_one;
comment on column public.people_private.one_on_one is
  'Retired 31 Oct 2026 (UI pass 1, round 3): 1-on-1 is per event (pins.solo_opt_in). Read by nothing.';

-- The one place the switch is read: your pin at that gathering, and nothing else.
create or replace function private.solo_choice(p_person uuid, p_gathering uuid) returns public.solo_visibility
language sql stable security definer set search_path = '' as $$
  select pi.solo_visibility from public.pins pi
  where pi.person_id = p_person and pi.gathering_id = p_gathering and pi.solo_opt_in;
$$;

-- The crowd page's switch, the "How do you want to meet?" sheet and A27's last step.
create function public.set_event_one_on_one(p_gathering uuid, p_on boolean, p_audience public.solo_visibility) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_pin public.pins;
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  select * into v_pin from public.pins where person_id = v_me and gathering_id = p_gathering for update;
  if v_pin.id is null then
    raise exception 'refused: pin in first' using errcode = '42501', hint = 'one_on_one_no_pin';
  end if;
  if coalesce(p_on, false) and not v_pin.open_to_meeting then
    raise exception 'refused: open to meeting first' using errcode = '42501', hint = 'one_on_one_needs_meeting';
  end if;
  -- The pin's own triggers do the rest: Q43's freeze, women-only eligibility, and closing
  -- the requests waiting here when it goes off or narrows.
  update public.pins set
    solo_opt_in = coalesce(p_on, false),
    solo_visibility = case when coalesce(p_on, false) then coalesce(p_audience, 'everyone') end
  where id = v_pin.id;
end;
$$;
revoke all on function public.set_event_one_on_one(uuid, boolean, public.solo_visibility) from public, anon;
grant execute on function public.set_event_one_on_one(uuid, boolean, public.solo_visibility) to authenticated;

-- Build 20's Settings switch, until the next build removes it: on or off at every upcoming
-- published event where you're open to meeting. Off is allowed at every one of your pins.
create or replace function public.set_one_on_one(p_on boolean, p_audience public.solo_visibility) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  if coalesce(p_on, false) then
    update public.pins pi set solo_opt_in = true, solo_visibility = coalesce(p_audience, 'everyone')
    from public.gatherings g
    where g.id = pi.gathering_id and pi.person_id = v_me and pi.open_to_meeting
      and private.is_published(g.id) and now() < public.effective_end(g);
  else
    update public.pins pi set solo_opt_in = false, solo_visibility = null
    from public.gatherings g
    where g.id = pi.gathering_id and pi.person_id = v_me and pi.solo_opt_in and now() < public.effective_end(g);
  end if;
end;
$$;

create or replace function public.my_one_on_one() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'on', coalesce(bool_or(pi.solo_opt_in), false),
    'audience', case when bool_or(pi.solo_visibility = 'women_only') then 'women_only' else 'everyone' end)
  from (select private.me() as id) me
  left join public.pins pi on pi.person_id = me.id and pi.solo_opt_in
    and exists (select 1 from public.gatherings g where g.id = pi.gathering_id and now() < public.effective_end(g))
  where me.id is not null;
$$;
