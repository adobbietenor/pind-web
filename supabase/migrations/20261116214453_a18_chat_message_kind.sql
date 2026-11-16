-- A18 #10 (Alex, 16 Nov 2026): a new message in your 1-on-1 chat or a squad you're in.
-- Its own migration: a new enum value cannot be used in the transaction that adds it. Its
-- switch, its triggers and its delivery check follow in a18_a24_message_push_report_block_ban.
alter type public.notification_kind add value if not exists 'chat_message';
