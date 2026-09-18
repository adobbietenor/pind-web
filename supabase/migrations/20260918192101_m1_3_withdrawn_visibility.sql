-- Phase 1 M1.3 — what "withdrawn" does to visibility (decisions.md Part 5, Alex M1.3;
-- docs/visibility.md V13). All of it in the database (H11).
--
-- A withdrawn gathering is a published gathering that is off: cancelled, postponed, a
-- takedown request, or another reason. Pins are kept. From the moment it is withdrawn:
--   1. only the people pinned to it can read its row and its counts (so their page
--      can show a short neutral notice); everyone else, anon included, sees nothing —
--      it leaves every public list;
--   2. nobody can pin to it, vote in its spot poll or submit its survey;
--   3. its "open to meeting" list closes, and so do both WhatsApp links, the
--      women-only offer and the spot poll counts (V1, V5 key off the same checks);
--   4. pinned people can still read and remove their own pin.
-- Un-withdrawing restores everything.
--
-- How: private.is_published and private.list_open now also require withdrawn_at to
-- be null. Every M1.1 rule already goes through one of those two, so pins, votes,
-- surveys, people, photos, +1s, reports, group links and the women-only offer all
-- follow without touching their policies. The gathering row, its spot options and
-- its counts get their own conditions below.

-- I am pinned at the gathering, opted in or not.
create function private.i_am_pinned_at(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pins pi where pi.gathering_id = p_gathering and pi.person_id = private.me()
  );
$$;

revoke execute on function private.i_am_pinned_at(uuid) from public;
grant execute on function private.i_am_pinned_at(uuid) to anon, authenticated;

-- V11 + withdrawn: public and not withdrawn. Used by pin and survey inserts and, through
-- private.i_am_open_at, by spot votes, the spot poll, group links and the women-only offer.
create or replace function private.is_published(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    where g.id = p_gathering and g.published_at is not null and g.withdrawn_at is null
  );
$$;

-- V1: the people list is open — published, not withdrawn, and until 24h after the end.
create or replace function private.list_open(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    where g.id = p_gathering
      and g.published_at is not null
      and g.withdrawn_at is null
      and now() < public.effective_end(g) + interval '24 hours'
  );
$$;

-- The row: published and live for everyone; withdrawn, only for the people pinned to it.
drop policy gatherings_read_published on public.gatherings;
create policy gatherings_read_published on public.gatherings
  for select to anon, authenticated
  using (published_at is not null and (withdrawn_at is null or private.i_am_pinned_at(id)));

-- Spot options: only while published and not withdrawn.
drop policy gathering_spots_read_published on public.gathering_spots;
create policy gathering_spots_read_published on public.gathering_spots
  for select to anon, authenticated
  using (exists (
    select 1 from public.gatherings g
    where g.id = gathering_id and g.published_at is not null and g.withdrawn_at is null
  ));

-- V2 + V3 counts: unchanged, except a withdrawn gathering's counts go only to the
-- people pinned to it.
create or replace function public.gathering_counts(gathering_ids uuid[])
returns table (
  gathering_id     uuid,
  pinned           integer,
  open_to_meeting  integer,
  women            integer,
  men              integer,
  other            integer,
  crews_open       boolean
)
language sql stable security definer set search_path = '' as $$
  with per_gathering as (
    select
      g.id as gid,
      coalesce(sum(pi.party_total), 0)::integer as n_pinned,
      (count(pi.id) filter (where pi.open_to_meeting and pe.hidden_at is null))::integer as n_open,
      (count(pi.id) filter (where pi.open_to_meeting and pe.hidden_at is null and pp.gender = 'woman'))::integer as n_women,
      (count(pi.id) filter (where pi.open_to_meeting and pe.hidden_at is null and pp.gender = 'man'))::integer as n_men
    from public.gatherings g
    left join public.pins pi on pi.gathering_id = g.id
    left join public.people pe on pe.id = pi.person_id
    left join public.people_private pp on pp.person_id = pi.person_id
    where g.id = any (gathering_ids)
      and g.published_at is not null
      and (g.withdrawn_at is null or private.i_am_pinned_at(g.id))
    group by g.id
  )
  select
    gid,
    n_pinned,
    n_open,
    case when n_open >= 5 then n_women end,
    case when n_open >= 5 then n_men end,
    case when n_open >= 5 and n_open - n_women - n_men > 0 then n_open - n_women - n_men end,
    n_open >= 5
  from per_gathering;
$$;

-- create or replace keeps the existing grants (anon and authenticated may execute).
