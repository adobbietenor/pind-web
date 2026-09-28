-- M3.3 — the groups' lifecycle job, corrected.
--
-- m3_3_small_groups took the poll's leader with a LATERAL join that referenced the
-- table being updated, which Postgres refuses (42P10) — the harness's first run of the
-- job (P156, P158) found it before anything depended on it. The leader is now two
-- correlated subqueries with the same ordering: most votes, then the earliest time,
-- then the first proposed. Everything else is unchanged.

create or replace function public.admin_groups_tick() returns jsonb
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

  -- Three hours before, a group of 3+ with no plan takes the poll's leader, or "at the
  -- start" when there is no poll.
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

  update public.crews c set state = 'done'
  from public.gatherings g
  where g.id = c.gathering_id and c.state in ('spot_set', 'live') and now() >= public.effective_end(g);
  get diagnostics v_done = row_count;

  return jsonb_build_object('expired', v_expired, 'dissolved', v_dissolved, 'planned', v_planned, 'live', v_live, 'done', v_done);
end;
$$;
