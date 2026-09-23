-- Phase 3 M3.1 — the two city-specific tag slugs become generic (Alex).
--
--   new-to-toronto           -> new-in-town
--   toronto-born-and-raised  -> born-and-raised
--
-- **The slug is the contract; the words are copy.** The displayed names stay
-- Toronto's — "new to Toronto", "Toronto born and raised" — because that is what a
-- reader in Toronto should see. When Vancouver is a row, its label is a commit and
-- not a data migration, which is the whole point of having made the city a row an
-- hour earlier.
--
-- **Done now because it is free now.** A slug is one-way once somebody has picked it,
-- and `person_tags` currently holds three rows belonging to one non-seed person —
-- **one of which is `new-to-toronto`**, so this is a real move rather than a rename
-- of something nobody uses. Three rows is a move; three thousand is a migration with
-- a maintenance window.
--
-- The order matters and is forced by `on delete restrict`: create the new slugs,
-- point the existing picks at them, and only then remove the old ones. Doing it the
-- other way round is refused by the foreign key, which is the behaviour we want —
-- the database will not let this half-happen.

-- **`tags.name` is unique as well as `sort_order`**, so the old rows have to give up
-- both before the new ones can take them. The words are the thing being kept, which
-- is exactly why they collide: this is a change of identifier, not of copy.
--
-- 1. Park the old rows' name and order out of the way. They are deleted three steps
--    down; this is only so the new rows can exist alongside them for a moment.
update public.tags
set name = name || ' ~replaced', sort_order = sort_order + 1000
where slug in ('new-to-toronto', 'toronto-born-and-raised');

-- 2. The new slugs, with the words a reader in Toronto should see.
insert into public.tags (slug, name, sort_order) values
  ('born-and-raised', 'Toronto born and raised', 30),
  ('new-in-town',     'new to Toronto',          31)
on conflict (slug) do nothing;

-- 3. Move every pick across. A person who had picked one keeps it, with the same
--    words on screen; nothing about their profile changes from where they sit.
update public.person_tags set tag = 'new-in-town'     where tag = 'new-to-toronto';
update public.person_tags set tag = 'born-and-raised' where tag = 'toronto-born-and-raised';

-- 4. Now the old ones are unreferenced and can go. If anything still pointed at them
--    this is refused, loudly, rather than orphaning a profile.
delete from public.tags where slug in ('new-to-toronto', 'toronto-born-and-raised');
