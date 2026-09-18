-- Phase 1 M1.1 — the visibility rules as functions (docs/visibility.md).
--
-- Helpers live in schema `private`, which PostgREST does not expose, so no visitor
-- can call them directly; policies call them. They are security definer so they can
-- read pins, blocks and people_private without the caller's RLS (which would recurse
-- or hide exactly the rows the rule has to check). Every one of them answers only
-- about the CURRENT session's person, or returns a yes/no — never rows.
--
-- The three public functions (gathering_counts, women_only_offer, spot_poll) return
-- aggregates or a boolean, never ids of people or names.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Building blocks (not granted to visitors; used by the functions below)
-- ---------------------------------------------------------------------------

-- The current session's person, or null.
create function private.me() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.people p where p.auth_user_id = auth.uid();
$$;

-- V11: the gathering is published.
create function private.is_published(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g where g.id = p_gathering and g.published_at is not null
  );
$$;

-- V1 (Q4): people lists at a gathering close 24h after its effective end.
create function private.list_open(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    where g.id = p_gathering
      and g.published_at is not null
      and now() < public.effective_end(g) + interval '24 hours'
  );
$$;

-- The person is pinned and opted in at the gathering, and not hidden.
create function private.is_open_at(p_person uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.pins pi
    join public.people pe on pe.id = pi.person_id
    where pi.person_id = p_person
      and pi.gathering_id = p_gathering
      and pi.open_to_meeting
      and pe.hidden_at is null
  );
$$;

-- V4: a block in either direction.
create function private.blocked_between(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

-- V5: eligible for women-only — woman, or nonbinary with the women-only flag.
create function private.is_women_only_eligible(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.people_private pp
    where pp.person_id = p_person
      and (pp.gender = 'woman' or (pp.gender = 'nonbinary' and pp.include_in_women_only))
  );
$$;

-- ---------------------------------------------------------------------------
-- The rules, relative to the current session (granted to authenticated)
-- ---------------------------------------------------------------------------

-- V1: I can see `p_target` at `p_gathering`. Both of us pinned and opted in there,
-- the list still open, no block either way, neither of us hidden.
-- App phases add "or we share a crew or a connection" (H3) HERE and nowhere else.
create function private.can_see_at(p_target uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select me.id <> p_target
       and private.list_open(p_gathering)
       and private.is_open_at(me.id, p_gathering)
       and private.is_open_at(p_target, p_gathering)
       and not private.blocked_between(me.id, p_target)
    from (select private.me() as id) me
    where me.id is not null
  ), false);
$$;

-- V1 at any gathering: I can see this person somewhere.
create function private.can_see(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pins t
    where t.person_id = p_target
      and t.open_to_meeting
      and private.can_see_at(p_target, t.gathering_id)
  );
$$;

-- I am pinned and opted in at a published gathering, and not hidden.
create function private.i_am_open_at(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_published(p_gathering)
     and private.is_open_at(private.me(), p_gathering);
$$;

-- V5: the women-only offer at this gathering is open to me — I am eligible and
-- opted in, and at least 3 eligible people (me included) are opted in.
create function private.women_only_open(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.i_am_open_at(p_gathering)
     and private.is_women_only_eligible(private.me())
     and (
       select count(*)
       from public.pins pi
       join public.people pe on pe.id = pi.person_id
       where pi.gathering_id = p_gathering
         and pi.open_to_meeting
         and pe.hidden_at is null
         and private.is_women_only_eligible(pi.person_id)
     ) >= 3;
$$;

-- V6: I may read this photo object. It must be an approved photo, it must sit in its
-- owner's own folder, and I must be able to see its owner (V1).
create function private.can_see_photo(p_object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.people pe
    where pe.photo_path = p_object_name
      and pe.photo_status = 'approved'
      and pe.auth_user_id is not null
      and split_part(p_object_name, '/', 1) = pe.auth_user_id::text
      and private.can_see(pe.id)
  );
$$;

revoke execute on all functions in schema private from public;
grant execute on function
  private.me(),
  private.is_published(uuid),
  private.can_see_at(uuid, uuid),
  private.can_see(uuid),
  private.i_am_open_at(uuid),
  private.women_only_open(uuid),
  private.can_see_photo(text)
to authenticated;

-- ---------------------------------------------------------------------------
-- V6: a new photo goes back to moderation. Otherwise an approved photo could be
-- swapped for an unmoderated one without admin ever seeing it.
-- ---------------------------------------------------------------------------

create function private.photo_change_resets_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.photo_path is distinct from old.photo_path then
    new.photo_status := 'pending';
  end if;
  return new;
end;
$$;

revoke execute on function private.photo_change_resets_status() from public;

create trigger people_photo_change_resets_status before update of photo_path on public.people
  for each row execute function private.photo_change_resets_status();

-- ---------------------------------------------------------------------------
-- Public functions — aggregates and yes/no only
-- ---------------------------------------------------------------------------

-- V2 + V3: counts for published gatherings. Readable by anyone, before pinning too.
--   pinned           sum of party_total, hidden people included (H6)
--   open_to_meeting  people opted in, hidden people excluded; never +1s (Q1)
--   women, men       only at 5+ open to meeting
--   other            every answer that is not woman or man; only at 5+, and only
--                    when above zero. women + men + other = open_to_meeting.
--   crews_open       5+ open to meeting
create function public.gathering_counts(gathering_ids uuid[])
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

-- V5: whether to show me the women-only group offer. Never a number (Alex, M1.1).
create function public.women_only_offer(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.women_only_open(p_gathering), false);
$$;

-- T6 spot poll: vote counts per spot option, only for someone opted in at the
-- gathering. A vote counts only while its voter is pinned, opted in and not hidden (V8).
create function public.spot_poll(p_gathering uuid)
returns table (gathering_spot_id uuid, votes integer)
language sql stable security definer set search_path = '' as $$
  select
    gs.id,
    (
      select count(*)
      from public.spot_votes v
      where v.gathering_spot_id = gs.id
        and private.is_open_at(v.person_id, p_gathering)
    )::integer
  from public.gathering_spots gs
  where gs.gathering_id = p_gathering
    and private.i_am_open_at(p_gathering)
  order by gs.meet_at;
$$;

revoke execute on function public.gathering_counts(uuid[]) from public, anon, authenticated;
revoke execute on function public.women_only_offer(uuid) from public, anon, authenticated;
revoke execute on function public.spot_poll(uuid) from public, anon, authenticated;
grant execute on function public.gathering_counts(uuid[]) to anon, authenticated;
grant execute on function public.women_only_offer(uuid) to authenticated;
grant execute on function public.spot_poll(uuid) to authenticated;
