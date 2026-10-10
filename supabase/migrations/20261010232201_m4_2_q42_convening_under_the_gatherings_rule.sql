-- M4.2 — Q42: convening_of answers only about a gathering the caller can read (V11, V18;
-- Alex, 10 Oct 2026).
--
-- What the review found: public.convening_of was SECURITY DEFINER and executable by anon,
-- with no condition on the gathering. Given any id, a signed-out visitor learned that a
-- draft (or dismissed, or seed) gathering exists — a non-null answer against null for a
-- random id — and whether it came from Ticketmaster ('a_spot_first' is the feed's
-- default). V11: drafts and dismissed gatherings are invisible. V18: a seed row is
-- invisible to every visitor.
--
-- The fix: it runs as the caller (SECURITY INVOKER), so the one definition of a readable
-- gathering — gatherings_read_published: published, not seed unless a tester, not
-- withdrawn unless pinned — decides, and anything else answers null exactly as a random
-- id does. Its callers (the room and group screens) read gatherings their person can
-- already see, so they are unaffected. Proved by P202; Q42 in the review suite turns
-- green.

alter function public.convening_of(uuid) security invoker;
