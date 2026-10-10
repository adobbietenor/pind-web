-- M3.2b — interests, remembered (Alex, M3.1; built 10 Oct 2026).
--
-- The list chips a person chose, kept so the app's list opens already narrowed to them.
-- **Not the tags** (Alex, 10 Oct): tags describe you to other people; this only shapes
-- what you see, and nothing else in the product reads it. Narrowing, never reordering
-- (Q10): the app applies only the interests that have a chip that week, so a remembered
-- interest can never empty the page.
--
-- Its own table, readable and writable by its owner alone — not a column on `people`,
-- which other people can read. Values are the list's own categories, so a made-up one is
-- refused by the type. Proved by P188–P190.

create table public.person_interests (
  person_id   uuid primary key references public.people (id) on delete cascade,
  categories  public.gathering_category[] not null default '{}'
                check (cardinality(categories) <= 8),
  updated_at  timestamptz not null default now()
);
alter table public.person_interests enable row level security;

revoke all on public.person_interests from public, anon, authenticated;
grant select, delete on public.person_interests to authenticated;
grant insert (person_id, categories), update (categories, updated_at) on public.person_interests to authenticated;

create policy person_interests_own_read on public.person_interests
  for select to authenticated using (person_id = private.me());
create policy person_interests_own_add on public.person_interests
  for insert to authenticated with check (person_id = private.me());
create policy person_interests_own_change on public.person_interests
  for update to authenticated using (person_id = private.me()) with check (person_id = private.me());
create policy person_interests_own_remove on public.person_interests
  for delete to authenticated using (person_id = private.me());
