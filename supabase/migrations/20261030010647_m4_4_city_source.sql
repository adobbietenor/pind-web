-- M4.4: the City of Toronto's Festivals & Events open data feed is a source.
--
-- Its own value, in its own migration: a new enum value cannot be used in the
-- transaction that adds it, and the next migration uses it.
alter type public.gathering_source add value if not exists 'city';
