-- M3.2 — the testers list: a V18 change, on M4.2's review list (Alex, M3.2).
--
-- The seed rule hides a seed row from EVERY visitor, signed in or not. That is right
-- for every purpose but one: walking a list with test people in it. So a short list of
-- real accounts — Alex and a friend — may, while signed in:
--
--   * see the seed gathering, its seed venue and spots, and its counts;
--   * pin there, and edit and remove that pin;
--   * see the seed people opted in THERE, under the usual reciprocal and block rules.
--
-- And nothing else changes:
--
--   * **Only the service key writes the list** (`admin_set_tester`); no visitor can read
--     it, and nobody can add themselves (P97).
--   * **A seed person is visible to a tester only at a seed gathering** — never at a
--     real one, where the seed rule holds for everybody (P98).
--   * **No public page changes.** Being a tester is a property of a signed-in session:
--     `i_am_tester()` is false without one, and the Worker reads every public page with
--     no user attached. The public door functions (`public_gathering`,
--     `public_gatherings`) keep their own `not is_seed` and are not touched; P96 calls
--     them with a tester's session and finds no seed row.

create table private.testers (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  added_at     timestamptz not null default now(),
  added_by     text not null,
  note         text
);
alter table private.testers enable row level security;
revoke all on private.testers from public, anon, authenticated;

comment on table private.testers is
  'Real accounts that may see seed rows while signed in (M3.2, a V18 change). Service key only; see admin_set_tester.';

-- True only for a signed-in account on the list. False for anon (auth.uid() is null),
-- and false for every account not listed.
create function private.i_am_tester() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and exists (select 1 from private.testers t where t.auth_user_id = auth.uid());
$$;
revoke all on function private.i_am_tester() from public;
grant execute on function private.i_am_tester() to anon, authenticated;

-- The admin's only door onto the list. Short on purpose: add or remove one account.
create function public.admin_set_tester(p_auth_user uuid, p_on boolean, p_actor text, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_on then
    if not exists (select 1 from auth.users where id = p_auth_user) then
      raise exception 'No account with that id';
    end if;
    insert into private.testers (auth_user_id, added_by, note)
    values (p_auth_user, p_actor, p_note)
    on conflict (auth_user_id) do nothing;
  else
    delete from private.testers where auth_user_id = p_auth_user;
  end if;
end;
$$;
revoke all on function public.admin_set_tester(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_tester(uuid, boolean, text, text) to service_role;

-- The list, for the admin page: who, since when, by whom.
create function public.admin_testers()
returns table (auth_user_id uuid, email text, added_at timestamptz, added_by text, note text)
language sql stable security definer set search_path = '' as $$
  select t.auth_user_id, u.email::text, t.added_at, t.added_by, t.note
  from private.testers t join auth.users u on u.id = t.auth_user_id
  order by t.added_at;
$$;
revoke all on function public.admin_testers() from public, anon, authenticated;
grant execute on function public.admin_testers() to service_role;

-- ---------------------------------------------------------------------------
-- The seed rule, with the tester exception. Each keeps its V18 comment's meaning for
-- everybody else.
-- ---------------------------------------------------------------------------

create or replace function private.is_published(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    where g.id = p_gathering
      and g.published_at is not null
      and g.withdrawn_at is null
      and (not g.is_seed or private.i_am_tester())
  );
$$;

create or replace function private.list_open(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    where g.id = p_gathering
      and g.published_at is not null
      and g.withdrawn_at is null
      and (not g.is_seed or private.i_am_tester())
      and now() < public.effective_end(g) + interval '24 hours'
  );
$$;

-- A seed person is open only at a seed gathering, and only to a tester. At a real
-- gathering the seed rule holds for everybody, testers included (P98).
create or replace function private.is_open_at(p_person uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.pins pi
    join public.people pe on pe.id = pi.person_id
    join public.gatherings g on g.id = pi.gathering_id
    where pi.person_id = p_person
      and pi.gathering_id = p_gathering
      and pi.open_to_meeting
      and pe.hidden_at is null
      and (not pe.is_seed or (g.is_seed and private.i_am_tester()))
  );
$$;

drop policy gatherings_read_published on public.gatherings;
create policy gatherings_read_published on public.gatherings
  for select to anon, authenticated
  using (
    published_at is not null
    and (not is_seed or private.i_am_tester())
    and (withdrawn_at is null or private.i_am_pinned_at(id))
  );

drop policy gathering_spots_read_published on public.gathering_spots;
create policy gathering_spots_read_published on public.gathering_spots
  for select to anon, authenticated
  using (exists (
    select 1 from public.gatherings g
    where g.id = gathering_id
      and g.published_at is not null
      and g.withdrawn_at is null
      and (not g.is_seed or private.i_am_tester())
  ));

drop policy venues_read on public.venues;
create policy venues_read on public.venues
  for select to anon, authenticated using (not is_seed or private.i_am_tester());

drop policy meeting_spots_read on public.meeting_spots;
create policy meeting_spots_read on public.meeting_spots
  for select to anon, authenticated
  using (not private.is_seed_venue(venue_id) or private.i_am_tester());

-- Counts: a tester gets the seed gathering's, with its seed people counted; everybody
-- else — and every public page, which asks with no session — gets what V18 gave.
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
      coalesce(sum(pi.party_total) filter (where private_counts.counted), 0)::integer as n_pinned,
      (count(pi.id) filter (where private_counts.counted and pi.open_to_meeting and pe.hidden_at is null))::integer as n_open,
      (count(pi.id) filter (where private_counts.counted and pi.open_to_meeting and pe.hidden_at is null and pp.gender = 'woman'))::integer as n_women,
      (count(pi.id) filter (where private_counts.counted and pi.open_to_meeting and pe.hidden_at is null and pp.gender = 'man'))::integer as n_men
    from public.gatherings g
    left join public.pins pi on pi.gathering_id = g.id
    left join public.people pe on pe.id = pi.person_id
    left join public.people_private pp on pp.person_id = pi.person_id
    cross join lateral (
      select pi.id is not null and (not pe.is_seed or (g.is_seed and private.i_am_tester())) as counted
    ) private_counts
    where g.id = any (gathering_ids)
      and g.published_at is not null
      and (not g.is_seed or private.i_am_tester())
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
