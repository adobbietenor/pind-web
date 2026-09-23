-- Phase 3 M3.1 — the tag list, redone (Alex, after walking A3).
--
-- **Why this is a migration and not a data migration.** Checked before writing it:
-- `person_tags` held three rows, all belonging to one non-seed person — Alex, from the
-- walk an hour earlier — and all three of those slugs survive into the new list. So
-- nobody real loses a tag and no data has to be rewritten. **That window closes the
-- moment a stranger picks one**, which is exactly why the count was checked rather
-- than assumed.
--
-- **What changed in the rules** (Alex):
--   * **at least three, up to ten**, where "at least three" is a rule on the A3 screen
--     and **never in the database** — the link path pins with no tags at all, so a
--     database minimum would make a pin impossible. The database enforces only the
--     maximum, as it did before; the maximum moves from 3 to 10.
--   * **the maximum is not advertised**, but an eleventh tap says so rather than
--     doing nothing. A control that silently ignores you looks broken, which is the
--     same fault as the code field that swallowed two digits of a pasted code.
--   * **three of them show on the "going & open to meeting" list, and the person
--     chooses which three.** All of them show on the profile behind it.
--
-- **Why the list changed** (Alex): the old fifteen skewed toward newcomers, and the
-- product is as much for somebody who has lived here ten years and wants a good night
-- out. This one weights **personality over circumstance**, with the locals and the
-- newcomers side by side in one small group. "Not drinking" and "enjoys a drink" are a
-- deliberate pair, like the opposites elsewhere: both tell somebody something useful
-- before they meet.

-- ---------------------------------------------------------------------------
-- Which three show on a list — a screen's question, not a visibility rule
-- ---------------------------------------------------------------------------
--
-- **This is deliberately not a policy.** Every tag a person holds is already readable
-- by anyone who can see that person (V19), and the profile behind the list shows all
-- of them. So choosing three for the row is about what fits on a line, not about who
-- may know what — nothing here narrows what anyone is allowed to read.
alter table public.person_tags add column on_list boolean not null default false;

comment on column public.person_tags.on_list is
  'The three a person chose to show on the going & open to meeting list. Not a visibility rule: every tag is readable by anyone V19 allows, and the profile shows them all.';

-- ---------------------------------------------------------------------------
-- The caps: ten tags, three of them on the list
-- ---------------------------------------------------------------------------
create or replace function private.person_tags_cap() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if (select count(*) from public.person_tags t where t.person_id = new.person_id) > 10 then
    raise exception 'A profile carries at most 10 tags';
  end if;
  if (select count(*) from public.person_tags t where t.person_id = new.person_id and t.on_list) > 3 then
    raise exception 'At most 3 tags show on the list';
  end if;
  return null;
end;
$fn$;

-- The cap now has to be checked on UPDATE too, because `on_list` is set by one.
drop trigger if exists person_tags_at_most_three on public.person_tags;
create constraint trigger person_tags_within_caps
  after insert or update on public.person_tags
  deferrable initially immediate
  for each row execute function private.person_tags_cap();

grant update (on_list) on public.person_tags to authenticated;
grant insert (person_id, tag, on_list) on public.person_tags to authenticated;

-- ---------------------------------------------------------------------------
-- The list itself
-- ---------------------------------------------------------------------------
--
-- Deleting first, with a loud failure rather than a quiet one: `person_tags.tag`
-- references `tags.slug` with `on delete restrict`, so if anybody has picked a tag
-- that is going away, this migration stops here and says whose. That is the guard
-- that makes "reseed now, cheaply" safe rather than hopeful.
do $check$
declare
  orphaned text;
begin
  select string_agg(distinct t.tag, ', ') into orphaned
  from public.person_tags t
  where t.tag not in (
    'chatty','will-talk-to-anyone','good-listener','dont-mind-the-quiet','takes-a-minute-to-warm-up',
    'happy-to-explain','the-hype-person','will-introduce-you-to-everyone','knows-all-the-good-spots',
    'always-looking-for-new-friends','up-for-whatever','will-try-anything-once','first-on-the-dance-floor',
    'loud-in-the-best-way','competitive-about-everything','overthinks-the-plan','always-slightly-late',
    'terrible-with-names','asks-too-many-questions','will-make-friends-with-the-bouncer','live-music',
    'club-nights','sport-of-any-kind','games-and-puzzles','anything-outdoors','comedy',
    'here-for-the-support-act','not-drinking','enjoys-a-drink','toronto-born-and-raised','new-to-toronto',
    'usually-go-alone'
  );
  if orphaned is not null then
    raise exception 'Somebody has picked a tag this list removes (%). That is a data migration now, not a reseed.', orphaned;
  end if;
end;
$check$;

delete from public.tags
where slug in ('small-and-chatty', 'first-time-at-this', 'will-try-what-im-bad-at');

-- `tags.sort_order` is UNIQUE, and the twelve rows that survive still hold their old
-- numbers 1-15. Without this the insert below collides on a number rather than on a
-- slug, and the ON CONFLICT clause never gets a chance to run. Parking them out of
-- range first lets each surviving row come back to its new place through the upsert.
update public.tags set sort_order = sort_order + 1000;

insert into public.tags (slug, name, sort_order) values
  -- Company
  ('chatty',                          'chatty',                            1),
  ('will-talk-to-anyone',             'will talk to anyone',               2),
  ('good-listener',                   'good listener',                     3),
  ('dont-mind-the-quiet',             'don''t mind the quiet',             4),
  ('takes-a-minute-to-warm-up',       'takes a minute to warm up',         5),
  ('happy-to-explain',                'happy to explain things',           6),
  ('the-hype-person',                 'the hype person',                   7),
  ('will-introduce-you-to-everyone',  'will introduce you to everyone',    8),
  ('knows-all-the-good-spots',        'knows all the good spots',          9),
  ('always-looking-for-new-friends',  'always looking for new friends',   10),
  -- What I'm like
  ('up-for-whatever',                 'up for whatever',                  11),
  ('will-try-anything-once',          'will try anything once',           12),
  ('first-on-the-dance-floor',        'first on the dance floor',         13),
  ('loud-in-the-best-way',            'loud in the best way',             14),
  ('competitive-about-everything',    'competitive about everything',     15),
  ('overthinks-the-plan',             'overthinks the plan',              16),
  ('always-slightly-late',            'always slightly late',             17),
  ('terrible-with-names',             'terrible with names',              18),
  ('asks-too-many-questions',         'asks too many questions',          19),
  ('will-make-friends-with-the-bouncer', 'will make friends with the bouncer', 20),
  -- Interests
  ('live-music',                      'live music',                       21),
  ('club-nights',                     'club nights',                      22),
  ('sport-of-any-kind',               'sport of any kind',                23),
  ('games-and-puzzles',               'games and puzzles',                24),
  ('anything-outdoors',               'anything outdoors',                25),
  ('comedy',                          'comedy',                           26),
  ('here-for-the-support-act',        'here for the support act',         27),
  -- Good to know
  ('not-drinking',                    'not drinking',                     28),
  ('enjoys-a-drink',                  'enjoys a drink',                   29),
  ('toronto-born-and-raised',         'Toronto born and raised',          30),
  ('new-to-toronto',                  'new to Toronto',                   31),
  ('usually-go-alone',                'usually go alone',                 32)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;
