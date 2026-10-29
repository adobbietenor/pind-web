-- M4.2 fixes (29 Oct 2026), approved by Alex as a batch (decisions, "M4.2: the review fixes").
--
-- R2 — A DECLINE STAYS UNREADABLE AFTER THE START. At the start a declined request becomes
--   "expired", exactly as an unanswered one does, so nothing the sender does afterwards
--   (switching 1-on-1 off, removing the pin, withdrawing by a kept id, blocking) can tell
--   the two apart. It used to stay "declined" — still pending to every closer — so the
--   sender's export read `closed` for the declined one and `not accepted` for the other, and
--   withdraw_solo succeeded on one and was refused on the other (R2a, R2b). The recipient's
--   answer is kept in `declined_by_recipient`: their own export still says they declined,
--   and the admin's metrics still count declines. No session reads the table (revoked since
--   20261014215515); only these functions do.
--
-- R5 — A REQUEST'S PUSH CHECKS THE REQUEST IS STILL THERE. The #8 ("X asked to meet you
--   1-on-1") was queued with no link to its request, so a block, a withdrawal or the sender
--   being hidden within the minute did not stop it: a safety removal still delivered his
--   name to the person he was removed for (Alex: "the part that matters"). Each #8 now names
--   its request, and the delivery query sends it only while the request is open, the sender
--   is not hidden and there is no block either way — checked in the query that picks what to
--   send (CLAUDE.md), at every attempt, retries included.

-- ---------------------------------------------------------------------------
-- R2
-- ---------------------------------------------------------------------------

alter table public.solo_proposals add column declined_by_recipient boolean not null default false;
comment on column public.solo_proposals.declined_by_recipient is
  'The recipient said no (M4.2). Kept apart from status, which becomes ''expired'' at the start for declined and unanswered alike, so the sender can never tell them apart. Read only by my_solo_export (the recipient''s own) and the metrics.';

update public.solo_proposals set declined_by_recipient = true where status = 'declined';

create function private.solo_proposals_remember_decline() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'declined' and old.status is distinct from 'declined' then
    new.declined_by_recipient := true;
  end if;
  return new;
end;
$$;
revoke all on function private.solo_proposals_remember_decline() from public;
create trigger solo_proposals_remember_decline
  before update of status on public.solo_proposals
  for each row execute function private.solo_proposals_remember_decline();

-- Declines already past their gathering's start: expired now, as the tick will do from here.
update public.solo_proposals p set status = 'expired', decided_at = coalesce(p.decided_at, now())
from public.gatherings g
where g.id = p.gathering_id and p.status = 'declined' and now() >= g.starts_at;

-- The recipient's own export keeps their answer; the sender's is unchanged (expired reads
-- "not accepted" after the start, as an unanswered one always has).
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
      join public.meeting_spots s on s.id = p.spot_id
      where p.from_person = private.me()
    ), '[]'::jsonb),
    'proposals_received', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gathering_id', p.gathering_id, 'spot', s.name, 'meet_at', p.meet_at, 'line', p.line, 'received_at', p.created_at,
        'status', case when p.declined_by_recipient then 'declined' else p.status::text end, 'answered_at', p.decided_at))
      from public.solo_proposals p
      join public.meeting_spots s on s.id = p.spot_id
      where p.to_person = private.me()
    ), '[]'::jsonb)
  );
$$;

-- The metrics count a decline by the recipient's answer, whatever its status became.
create or replace view private.solo_metrics_by_gathering as
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
  (select count(*) from public.solo_proposals p where p.gathering_id = g.id and p.declined_by_recipient) as declined,
  (select count(*) from public.solo_proposals p where p.gathering_id = g.id and p.status = 'expired' and not p.declined_by_recipient) as expired,
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

-- ---------------------------------------------------------------------------
-- R5
-- ---------------------------------------------------------------------------

alter table public.notifications add column solo_proposal_id uuid references public.solo_proposals (id) on delete set null;
comment on column public.notifications.solo_proposal_id is
  'For a #8 (solo_proposal): the request it is about (M4.2). Delivery sends it only while that request is open, its sender is not hidden and there is no block either way.';

create or replace function private.notify_solo_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := private.gathering_tz(new.gathering_id);
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (person_id, kind, gathering_id, solo_proposal_id, title, body, path)
    select new.to_person, 'solo_proposal', new.gathering_id, new.id, private.gathering_name(new.gathering_id),
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

-- Whether a #8 may still go out, read at every delivery attempt.
create function private.solo_request_still_deliverable(p_proposal uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.solo_proposals p
    join public.people f on f.id = p.from_person
    where p.id = p_proposal
      and p.status = 'open'
      and f.hidden_at is null
      and not private.blocked_between(p.from_person, p.to_person)
  );
$$;
revoke all on function private.solo_request_still_deliverable(uuid) from public;

create or replace function public.admin_pending_notifications(p_limit integer default 100)
returns table (id uuid, person_id uuid, kind public.notification_kind, title text, body text, path text, attempts smallint,
               tokens text[], email text)
language sql stable security definer set search_path = '' as $$
  select n.id, n.person_id, n.kind, n.title, n.body, n.path, n.attempts,
    case when private.is_harness_user(p.auth_user_id) or p.is_seed then '{}'::text[]
         else array(select d.token from public.device_tokens d where d.person_id = n.person_id order by d.last_seen_at desc) end,
    case when private.is_harness_user(p.auth_user_id) or p.is_seed then null
         else (select u.email::text from auth.users u where u.id = p.auth_user_id and not coalesce(u.is_anonymous, false)) end
  from public.notifications n
  join public.people p on p.id = n.person_id
  where n.sent_at is null and n.attempts < 3
    and not (n.kind = 'solo_proposal' and private.solo_brake_pulled())
    -- R5: a request that closed, a hidden sender or a block stops its push, at any attempt.
    and (n.kind <> 'solo_proposal' or (n.solo_proposal_id is not null and private.solo_request_still_deliverable(n.solo_proposal_id)))
  order by n.created_at
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- R2, the tick: declined and unanswered expire together at the start.
-- (admin_groups_tick as 20261015004343, that one condition changed.)
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
