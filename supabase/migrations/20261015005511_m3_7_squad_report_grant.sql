-- M3.7: reports_insert_on_visible_squad calls private.is_squad as the reporter, and the
-- squads migration never granted it. Postgres checks a policy function's EXECUTE for every
-- insert on the table, whichever policy would have allowed it, so EVERY report — on a
-- person, a message, a room message — failed with "permission denied" until this grant.
-- Found by the first full policy run after the squads migration (P34–P36, P78 and more).
-- It reads one row's kind and legacy flag and returns a boolean: nothing about a person.
grant execute on function private.is_squad(uuid) to authenticated;
