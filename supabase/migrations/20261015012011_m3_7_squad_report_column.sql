-- M3.7: reporting a squad needs the column it names. The squads migration added the policy
-- (reports_insert_on_visible_squad) but authenticated could never write target_crew_id: the
-- grant is per column (M1.1: reporter_id, target_kind, target_person_id, reason; M3.3 added
-- target_room_message_id). Found by P236's first run, whose control failed with
-- "permission denied for table reports". The policy still decides which squad.
grant insert (target_crew_id) on public.reports to authenticated;
