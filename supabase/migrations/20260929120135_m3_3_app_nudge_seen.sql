-- M3.3 — "Get the app", shown once, when someone first joins a group (build plan §8
-- M3.3; spec A18). "Once" is per person, not per browser, so it is recorded on the
-- person's own private row, which only they read and write (people_private's own-row
-- policies, V-own). Set when the nudge is shown.
alter table public.people_private add column app_nudge_seen_at timestamptz;
grant update (app_nudge_seen_at) on public.people_private to authenticated;
