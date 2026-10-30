-- UI pass 1, round 2 (Alex, 30 Oct 2026): the ninth notification, a keep-in-touch request
-- (spec A18 #9), sent the way a 1-on-1 request is. Its own migration: a new enum value
-- cannot be used in the transaction that adds it. Its switch, its trigger and its delivery
-- check follow in a18_keep_request_push.
alter type public.notification_kind add value if not exists 'keep_request';
