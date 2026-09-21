-- Phase 3 M3.1 — a person may change which of their tags show on the list.
--
-- **A grant with no policy behind it is a grant that can never work.** The tag
-- migration granted `update (on_list)` and gave `person_tags` no UPDATE policy, so
-- every such update matched **zero rows and reported success**. That is the silent-no
-- shape again: not an error, not a refusal, just nothing happening — and it would
-- have reached the walk as "the three I chose didn't stick", with nothing anywhere
-- saying why.
--
-- It was caught because P77 asserts the cap by *trying to exceed it* and expects to
-- be refused. Getting no error at all is what exposed the missing policy — a case
-- written to prove a limit turned out to prove the write worked first.
--
-- The rule is unchanged and needs no new decision: **your own tags are yours** — add,
-- remove, and change which three are featured. `on_list` is the only updatable column
-- (the grant says so), so this cannot be used to move a tag onto somebody else's
-- profile, or to change which tag a row points at.
--
-- It is **not** a visibility rule. Every tag a person holds is readable by anyone V19
-- allows either way, and the profile behind the list shows all of them; choosing three
-- picks a headline, not an audience.

create policy person_tags_update_own on public.person_tags
  for update to authenticated
  using (person_id = private.me())
  with check (person_id = private.me());
