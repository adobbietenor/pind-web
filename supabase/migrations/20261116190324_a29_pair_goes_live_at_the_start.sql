-- A29: a 1-on-1 with no place or time goes live and done (20261116185711) — but a live or
-- done group must say when it meets (crews_plan_matches_state). A pair that never set a time
-- meets "at the event", so its meet_at becomes the gathering's start as it goes live: the
-- same default set_solo_place gives a place with no time. Nobody is asked for anything.
-- Otherwise admin_groups_tick exactly as 20261116185711.

create or replace function public.admin_groups_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expired int; v_dissolved int; v_planned int; v_live int; v_done int; v_solo_expired int; v_solo_closed int;
begin
  update public.crew_invites i set status = 'expired', decided_at = now()
  from public.gatherings g
  where g.id = i.gathering_id and i.status = 'sent' and now() >= g.starts_at;
  get diagnostics v_expired = row_count;

  -- 1-on-1 requests lapse at the effective end (16 Nov 2026; was the start); a withdrawn gathering's close.
  update public.solo_proposals p set status = 'expired', decided_at = now()
  from public.gatherings g
  where g.id = p.gathering_id and p.status in ('open', 'declined') and now() >= public.effective_end(g);
  get diagnostics v_solo_expired = row_count;
  update public.solo_proposals p set status = 'closed', decided_at = coalesce(p.decided_at, now())
  from public.gatherings g
  where g.id = p.gathering_id and private.solo_pending(p.status) and g.withdrawn_at is not null;
  get diagnostics v_solo_closed = row_count;

  update public.crews c set state = 'dissolved', dissolved_at = now()
  from public.gatherings g
  where g.id = c.gathering_id and c.state = 'forming' and c.kind = 'crew'
    and now() >= least(greatest(g.starts_at - interval '6 hours', c.created_at + interval '2 hours'), g.starts_at - interval '3 hours')
    and private.active_members(c.id) < 3;
  get diagnostics v_dissolved = row_count;
  update public.crew_members m set left_at = now()
  from public.crews c
  where c.id = m.crew_id and c.state = 'dissolved' and m.left_at is null;
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

  -- A plan, or a 1-on-1 with or without a place, goes live 3 h before the start; a pair
  -- with no time meets at the start.
  update public.crews c set state = 'live', meet_at = coalesce(c.meet_at, g.starts_at)
  from public.gatherings g
  where g.id = c.gathering_id
    and (c.state = 'spot_set' or (c.kind = 'solo' and c.state = 'forming'))
    and now() >= g.starts_at - interval '3 hours';
  get diagnostics v_live = row_count;

  update public.crews c set state = 'done', meet_at = coalesce(c.meet_at, g.starts_at)
  from public.gatherings g
  where g.id = c.gathering_id
    and (c.state in ('spot_set', 'live') or (c.kind = 'solo' and c.state = 'forming'))
    and now() >= case when c.kind = 'solo' or not c.legacy
                      then greatest(public.effective_end(g), coalesce(c.meet_at, g.starts_at) + interval '1 hour')
                      else public.effective_end(g) end;
  get diagnostics v_done = row_count;

  return jsonb_build_object('expired', v_expired, 'dissolved', v_dissolved, 'planned', v_planned, 'live', v_live, 'done', v_done,
                            'solo_expired', v_solo_expired, 'solo_closed', v_solo_closed);
end;
$$;
