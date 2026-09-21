-- Phase 3 M3.1 — "export my data" includes the reports you filed (Alex, M3.1).
--
-- His words: **"yes, include the reports I filed — my reason and the date. Not the
-- moderation outcome, which isn't mine."** And: the export reads as you through RLS
-- rather than with the service key, so it cannot over-return.
--
-- That second half is why this migration exists at all. V9 says a reporter can file a
-- report and **read none**, which was right while nothing needed to read one; an
-- export read as the person hits exactly that wall. The service key would walk around
-- it, and walking around RLS is how an export quietly becomes a different, wider
-- query (H11).
--
-- **What opens, precisely.** A reporter may select **their own** rows, and the column
-- grant lets them see four things: the report's id, what kind of thing it was about,
-- the reason they chose, and when they filed it.
--
-- **What stays shut, and why each one matters:**
--
--   `status`                    would tell a reporter whether their report landed —
--                               and `auto_hidden` would tell them their report hid
--                               someone, which is exactly what H9 keeps quiet.
--   `decision_note`, `reviewed_at`   the moderator's work, not theirs.
--   `is_safety`                 derived from the reason; it is our triage, not their
--                               statement.
--   `reported_content_snapshot` someone else's words, kept for moderation.
--   `target_*`, `reporter_id`   ids mean nothing in an export, and a target id is a
--                               pointer at another person.
--
-- Nothing changes for anyone else: a report is still unreadable by its target, by any
-- other person, and by `anon`. Harness P78.

grant select (id, target_kind, reason, created_at) on public.reports to authenticated;

create policy reports_read_own_filed on public.reports
  for select to authenticated using (reporter_id = private.me());

comment on policy reports_read_own_filed on public.reports is
  'V9, extended in M3.1 for "export my data": a reporter reads their own reason and date, never the moderation outcome. Column grants, not this policy, are what keep status and the decision note out.';
