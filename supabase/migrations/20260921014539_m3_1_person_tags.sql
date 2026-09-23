-- Phase 3 M3.1 — V19: who may read somebody's three tags (Alex, M3.1).
--
-- The rule, in plain English:
--
--   Your own tags are always yours — read, add, remove, whenever.
--
--   Someone else's tags are readable **exactly when you can see that person at all**.
--   Same rule as their first name and their neighbourhood, no wider and no narrower:
--   `private.can_see`. Both of you pinned and opted in at the same gathering, no block
--   in either direction, neither of you hidden, the list still open.
--
--   Nobody else, ever: not `anon`, not somebody who pinned without opting in, not a
--   blocked person in either direction, not a hidden person, and never on a public
--   page or in a link preview.
--
-- **Why this rides V1 rather than inventing a stricter rule, which V17 needed.** An
-- Instagram handle is a way to contact someone off Pin'd, so it earned its own rule.
-- A tag is a conversation handle the person chose **in order to be read by the people
-- on the list with them** — that is what it is for (spec A3: conversation handles,
-- never match criteria; there is no matching anywhere). So it travels with the first
-- name, and it picks up the crew and connection branches for free when H3 adds them
-- to `can_see_at` — the same saving as V17 having two branches instead of three.
--
-- **At most 3, never exactly 3** (Alex, M3.1). "Exactly 3" is what a *complete*
-- profile means and A3 is what asks for three. A minimum in the database would make a
-- pin impossible on the link path, where a profile is deliberately incomplete
-- (decisions Part 5, "Neighbourhood and tags on the link path": optional, nudged
-- later, never a gate before a pin). A maximum is a different thing: without one,
-- `person_tags` is a place to write fifteen.
--
-- **The vocabulary is public reference data.** `tags` is the fifteen seeded rows and
-- says nothing about anyone, so it is readable exactly like `neighbourhoods`.

-- ---------------------------------------------------------------------------
-- The vocabulary — readable by everyone, writable by nobody but the service key.
-- ---------------------------------------------------------------------------

grant select on public.tags to anon, authenticated;

create policy tags_read on public.tags
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- A person's tags — V19.
-- ---------------------------------------------------------------------------

grant select on public.person_tags to authenticated;
grant insert (person_id, tag) on public.person_tags to authenticated;
grant delete on public.person_tags to authenticated;
-- No update: a tag is added or removed, never edited into a different one, so there
-- is no verb here that needs granting.

create policy person_tags_read_own on public.person_tags
  for select to authenticated using (person_id = private.me());

create policy person_tags_read_visible on public.person_tags
  for select to authenticated using (private.can_see(person_id));

create policy person_tags_insert_own on public.person_tags
  for insert to authenticated with check (person_id = private.me());

create policy person_tags_delete_own on public.person_tags
  for delete to authenticated using (person_id = private.me());

-- The cap, in the database rather than in a screen. A rule the app enforces alone is
-- a rule a session token can walk around (docs/visibility.md §1: a visitor's token is
-- theirs, and the Worker is not a gate).
create function private.person_tags_cap() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if (select count(*) from public.person_tags t where t.person_id = new.person_id) > 3 then
    raise exception 'A profile carries at most 3 tags';
  end if;
  return null;
end;
$fn$;

create constraint trigger person_tags_at_most_three
  after insert on public.person_tags
  deferrable initially immediate
  for each row execute function private.person_tags_cap();

comment on table public.person_tags is
  'V19. Exactly 3 is what a complete profile means and A3 asks for it; the database caps at 3 and sets no minimum, because the link path pins with none.';
