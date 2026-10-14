-- M3.4 — the eighth notification, a received 1-on-1 proposal (Alex, 14 Oct 2026; spec
-- A18 #8; decisions, "M3.4: who can see whom in 1-on-1"). Its own migration: a new enum
-- value cannot be used in the transaction that adds it. Its switch, its trigger and A18's
-- line follow in m3_4_solo_proposals_and_plan (N08/N09 hold them together).
alter type public.notification_kind add value if not exists 'solo_proposal';
