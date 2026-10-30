-- A16 — "How was it?" is the only question after the night (UI pass 1; Alex, 30 Oct 2026,
-- decisions "UI pass 1: the screen review and what it decided", call 5 and group 2 call h).
--
-- What changes, in plain English (approved before this was written):
--   * One optional question, three taps: Great / Okay / Not for me. No text box. "Done"
--     without answering writes nothing at all.
--   * "Would you have gone alone anyway?", "how many did you meet" and the comment box are
--     no longer collected. Their columns stay, nullable, with every past row as it was.
--   * Who can see an answer is unchanged: its author, and the team with the service key.
--     Who can write one is unchanged: the person themselves, after the gathering's end, at
--     a gathering they were open to meeting at, once (survey_responses_insert_own and the
--     unique (gathering_id, person_id)).
--
-- How the database holds it:
--   * a new enum and a nullable column, how_was_it;
--   * would_have_gone loses its not-null (met lost it in M3.3);
--   * the insert grant is narrowed to the columns the screen still writes, so the old
--     questions cannot be answered from an old build or by hand (42501), and a new row must
--     carry an answer (NOT VALID: past rows, which have none, are left alone).

create type public.survey_how_was_it as enum ('great', 'okay', 'not_for_me');

alter table public.survey_responses add column how_was_it public.survey_how_was_it;
comment on column public.survey_responses.how_was_it is
  'A16''s one question since UI pass 1 (30 Oct 2026): Great / Okay / Not for me. Null only on rows written before it.';

alter table public.survey_responses alter column would_have_gone drop not null;

alter table public.survey_responses
  add constraint survey_responses_answered check (how_was_it is not null) not valid;

revoke insert on public.survey_responses from authenticated;
grant insert (gathering_id, person_id, how_was_it) on public.survey_responses to authenticated;
