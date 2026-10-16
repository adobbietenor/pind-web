// The report queue's read, kept in one place so the policy harness runs the admin's own
// query (P246) — the two foreign keys from reports to crews (target_crew_id, context_crew_id)
// make a bare `crews(...)` ambiguous, so each embed names its key.
//
// Where a report came from (Alex, 16 Oct 2026): a report filed from a message carries the
// room or the thread, and the message's time — enough to go and look — and never its words.
export const ADMIN_REPORT_SELECT =
  "id, reporter_id, target_person_id, reason, is_safety, status, created_at, context_at, " +
  "context_room:rooms!reports_context_room_id_fkey(id, number, women_only, gatherings(id, name)), " +
  "context_crew:crews!reports_context_crew_id_fkey(id, kind, name, gatherings(id, name))";
