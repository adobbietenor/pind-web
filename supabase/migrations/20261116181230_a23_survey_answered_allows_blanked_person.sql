-- A23: "Delete my account" failed (500) for anyone who answered A16's survey before
-- 30 Oct 2026 (found by the staging reset, 16 Nov 2026).
--
-- `survey_responses_answered` (20261030171906) was added NOT VALID, so the rows from
-- before "How was it?" — how_was_it null — were never checked. But a NOT VALID check
-- still judges every UPDATE, and deleting a person updates their answers: the foreign
-- key is `on delete set null`. So the blanking of an old answer was refused, the person
-- delete rolled back, and A23 returned the constraint's message.
--
-- The rule now: an answer says how it was, unless it no longer belongs to anyone. A
-- blanked old answer is what A23 is designed to keep (the answer stays, the person
-- goes); everything else is judged as before. A check judges only the row it ends up
-- with, so the harness proves this on the blanked shape itself (P305) and that an
-- answered row still cannot lose its answer while it has a person (P301).
--
-- Still NOT VALID: this repo cannot see production's old rows, and VALIDATE would fail
-- the migration if any of them still have a person. It changes nothing for them except
-- that their deletion now goes through.

alter table public.survey_responses drop constraint survey_responses_answered;

alter table public.survey_responses
  add constraint survey_responses_answered check (how_was_it is not null or person_id is null) not valid;

comment on constraint survey_responses_answered on public.survey_responses is
  'An answer says how it was, unless its person was deleted (A23 blanks it; the answer stays). NOT VALID: rows from before 30 Oct 2026 have no how_was_it.';
