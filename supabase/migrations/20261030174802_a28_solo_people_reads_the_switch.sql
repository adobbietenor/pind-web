-- A28 (UI pass 1) follow-up: two readers still read the old per-pin flag instead of asking
-- private.solo_choice, the one place the switch is read since 20261030174015.
--   * solo_people (A29's list): listed only people with pins.solo_opt_in, so the account
--     switch listed nobody. Who it lists is unchanged otherwise: can_see_solo decides.
--   * the admin's 1-on-1 metrics: counted only pin flags, which would have reported zero
--     people switched on — an instrument wrong in a way that looks like a finding.

create or replace function public.solo_people(p_gathering uuid)
returns table (person_id uuid, party_total smallint)
language sql stable security definer set search_path = '' as $$
  select pi.person_id, pi.party_total
  from public.pins pi
  where pi.gathering_id = p_gathering
    and private.solo_choice(pi.person_id, p_gathering) is not null
    and private.can_see_solo(pi.person_id, p_gathering);
$$;

create or replace view private.solo_metrics_by_gathering as
select
  g.id as gathering_id,
  g.name,
  g.starts_at,
  -- Availability first: without spots there is no 1-on-1 to choose (decisions).
  private.has_spots(g.id) as has_spots,
  (select count(*) from public.pins p where p.gathering_id = g.id) as pinned,
  (select count(*) from public.pins p where p.gathering_id = g.id and p.open_to_meeting) as open_to_meeting,
  (select count(*) from public.pins p where p.gathering_id = g.id and private.solo_choice(p.person_id, g.id) is not null) as solo_opted,
  (select count(*) from public.pins p where p.gathering_id = g.id and private.solo_choice(p.person_id, g.id) = 'women_only') as solo_women_only,
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
