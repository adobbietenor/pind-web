-- Phase 3 M3.1 — V17: the Instagram handle moves off the people row.
--
-- The rule (docs/visibility.md V17; decisions.md Part 5, "Instagram handle"):
--
--   A person may add one Instagram handle. They can always read and edit their own.
--   Someone else may read it only if they SHARE A CREW with that person, or are a
--   CONNECTION of theirs -- and only if nothing else already hides the person from
--   them. Nobody else, ever: not someone who can only see them on the open "going &
--   open to meeting" list, not a pending join requester, not `anon`, and not any
--   public page or link preview.
--
-- **Why a table and not a column rule.** RLS decides which ROWS a role may read,
-- never which columns, so a value that must stay hidden from people who can read the
-- rest of the row has to move to its own table with its own policy. That is the same
-- reason gender and birth year live in `people_private` (M1.1, D1). Until this
-- migration the handle sat on `people`, so every person on the open list could read
-- it -- V17 has been stricter than the schema since the day it was written.
--
-- **Two branches, not three.** The spec names three readers: crewmates, a solo-plan
-- partner, and connections. A solo plan IS a crew (`kind = 'solo'`, M3.4), so the
-- solo partner falls out of the crew branch for free and needs no rule of its own;
-- M3.4 adds the column and the harness case that proves it.
--
-- **A crew is a crew whatever its state** (Alex, M3.1): forming, spot set, live, done
-- and dissolved all count. What ends the sight of a handle is LEAVING (`left_at`),
-- not the crew's state. A crew hidden by moderation (`crews.hidden_at`) grants
-- nothing, on the same footing as a hidden person -- moderation is not a crew state.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table public.person_handles (
  person_id   uuid primary key references public.people (id) on delete cascade,
  instagram   text not null check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.person_handles is
  'V17. One optional Instagram handle per person, readable only by a crewmate (a solo-plan partner is a crewmate) or a connection. Never on the open list, never public.';

create trigger person_handles_set_updated_at before update on public.person_handles
  for each row execute function public.set_updated_at();

insert into public.person_handles (person_id, instagram)
select id, instagram_handle from public.people where instagram_handle is not null;

-- The Test 0 rule "a photo OR a handle" goes with the column. It was never right for
-- the link path: a quick pin (A26) has neither, and the app requires the photo
-- separately (Q2).
alter table public.people drop constraint people_photo_or_instagram;
alter table public.people drop column instagram_handle;

alter table public.person_handles enable row level security;
revoke all on public.person_handles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The rule, as functions (private schema: PostgREST does not expose it)
-- ---------------------------------------------------------------------------

-- Hidden by moderation. Named once so every rule asks the same question.
create function private.is_hidden(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.people pe where pe.id = p_person and pe.hidden_at is not null
  );
$$;

-- V17 branch 1: we are both still in one crew. Any crew state; a crew hidden by
-- moderation counts for nothing. Covers a solo plan once M3.4 makes one a crew.
create function private.share_crew(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.crew_members mine
    join public.crew_members theirs on theirs.crew_id = mine.crew_id
    join public.crews c on c.id = mine.crew_id
    where mine.person_id = private.me()
      and mine.left_at is null
      and theirs.person_id = p_target
      and theirs.left_at is null
      and c.hidden_at is null
  );
$$;

-- V17 branch 2: we are connected. The pair is stored ordered (person_a < person_b),
-- so both directions are one row.
create function private.are_connected(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.connections c
    where (c.person_a = private.me() and c.person_b = p_target)
       or (c.person_b = private.me() and c.person_a = p_target)
  );
$$;

-- V17: may I read this person's handle? Either branch, and nothing hiding either of
-- us from the other. V1 is deliberately NOT part of this: sharing the open list is
-- not enough, and a crewmate is still a crewmate after the list at that gathering
-- has closed.
create function private.can_see_handle(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select me.id <> p_target
       and (private.share_crew(p_target) or private.are_connected(p_target))
       and not private.blocked_between(me.id, p_target)
       and not private.is_hidden(me.id)
       and not private.is_hidden(p_target)
    from (select private.me() as id) me
    where me.id is not null
  ), false);
$$;

grant execute on function
  private.is_hidden(uuid),
  private.share_crew(uuid),
  private.are_connected(uuid),
  private.can_see_handle(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and policies
-- ---------------------------------------------------------------------------

grant select on public.person_handles to authenticated;
grant insert (person_id, instagram) on public.person_handles to authenticated;
grant update (instagram) on public.person_handles to authenticated;
grant delete on public.person_handles to authenticated;

create policy person_handles_read_own on public.person_handles
  for select to authenticated using (person_id = private.me());

create policy person_handles_read_visible on public.person_handles
  for select to authenticated using (private.can_see_handle(person_id));

create policy person_handles_insert_own on public.person_handles
  for insert to authenticated with check (person_id = private.me());

create policy person_handles_update_own on public.person_handles
  for update to authenticated
  using (person_id = private.me()) with check (person_id = private.me());

create policy person_handles_delete_own on public.person_handles
  for delete to authenticated using (person_id = private.me());
