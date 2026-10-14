-- M3.4 — a 1-on-1 plan can end after its spot and time are set (decisions, "M3.4: the
-- 1-on-1 lifecycle": either leaves, or H9). The M3.3 rule said a dissolved group has no
-- spot and no time, true while groups dissolved only from forming; it refused every 1-on-1
-- dissolve, so leaving errored (found by P221 on its first run). A dissolved plan now
-- keeps the spot and time it had — the record of what was called off. Forming still has
-- neither, and a set, live or done plan still has its time.
alter table public.crews drop constraint crews_plan_matches_state;
alter table public.crews add constraint crews_plan_matches_state check (
  (state = 'forming' and spot_id is null and meet_at is null)
  or state = 'dissolved'
  or (state in ('spot_set', 'live', 'done') and meet_at is not null)
);
