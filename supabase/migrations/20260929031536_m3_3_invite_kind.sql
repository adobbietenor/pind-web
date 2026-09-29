-- M3.3 — the seventh notification, "invite" from a connection (Alex, 29 Sept 2026: A20's
-- one verb). Its own migration: a new enum value cannot be used in the transaction that
-- adds it, and m3_3_after_the_night uses it.
alter type public.notification_kind add value if not exists 'invite';
