-- Phase 3 M3.1 — seed public.tags (Alex, M3.1; spec A3).
--
-- The list and the reasoning behind it are `packages/shared/src/tags.ts`, which stays
-- the display source: this table holds the slug, which is the contract, plus the name
-- and an order so the table is self-describing on its own.
--
-- **This seed is one-way in one direction only, and that is what set its length.**
-- `person_tags.tag references public.tags (slug) on delete restrict`, so:
--
--   * adding a tag later is an INSERT — cheap, any time;
--   * removing a tag anybody has picked is a DATA MIGRATION — the delete is refused
--     while a single `person_tags` row points at it.
--
-- The two directions are not symmetric, so fifteen rather than the draft's twenty:
-- the safe error is short (Alex, M3.1). Rewording is free forever either way — the
-- `name` is copy, the `slug` is the identifier, and only the slug is referenced.
--
-- What the draft got wrong, recorded so the next revision does not repeat it: four of
-- its twenty tags meant nothing outside a ticketed arena, ten of twenty were sports or
-- music, and the community third of the product had a single slug. The replacement is
-- four groups of ways-of-being, so the same three tags say something at an arena, at a
-- gig and at a 9am run.
--
-- **`not-drinking` is the load-bearing one** — the only tag that changes what a crew
-- does (where it meets) rather than describing someone.
--
-- No privileges or policies here: `tags` and `person_tags` stay locked to visitors
-- (docs/visibility.md §15) until the rule for reading somebody's tags is agreed and
-- built with A3 and A22.

insert into public.tags (slug, name, sort_order) values
  -- New here
  ('new-to-toronto',           'new to Toronto',                  1),
  ('usually-go-alone',         'usually go alone',                2),
  ('first-time-at-this',       'first time at this sort of thing', 3),
  -- Company
  ('small-and-chatty',         'small and chatty',                4),
  ('dont-mind-the-quiet',      'don''t mind the quiet',           5),
  ('happy-to-explain',         'happy to explain things',         6),
  ('not-drinking',             'not drinking',                    7),
  -- What I'm like
  ('always-slightly-late',     'always slightly late',            8),
  ('will-talk-to-anyone',      'will talk to anyone',             9),
  ('up-for-whatever',          'up for whatever',                10),
  -- Bring me into
  ('sport-of-any-kind',        'sport of any kind',              11),
  ('games-and-puzzles',        'games and puzzles',              12),
  ('anything-outdoors',        'anything outdoors',              13),
  ('here-for-the-support-act', 'here for the support act',       14),
  ('will-try-what-im-bad-at',  'will try the thing I''m bad at',  15)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

comment on table public.tags is
  'The fixed tag vocabulary (spec A3). Conversation handles, never match criteria. A slug is one-way once anybody has picked it (person_tags references it on delete restrict); the name is copy and lives in packages/shared.';
