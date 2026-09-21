// The tag list (Alex, M3.1 — final; seeded by
// `20260921…_m3_1_seed_tags`). It replaces the M2.0 draft, which was twenty tags in
// four groups and skewed hard to an arena: four of them (post-game pints, loud in the
// 300s, away-game bars, season splitter) meant nothing anywhere but a ticketed game,
// and the community third of the product — run clubs, games nights, markets, library
// circles — had one slug between it, filed under a group called "How you do a night"
// that assumed an evening.
//
// **Tags are conversation handles, not match criteria** (spec A3). There is no
// matching anywhere in Pin'd. A person picks exactly 3 (`TAGS_PER_PROFILE`), once,
// and those 3 travel with them to every gathering they pin — which is why nothing
// here is arena-shaped.
//
// **Three rules the list was cut against:**
//
//  1. **The vibe chips own the night; the tags own the person** (Alex, M3.1). Anything
//     about when you arrive, how long you stay or what you drink belongs to the crew
//     (spec §3, "Crew vibe"), not to the person. The draft collided with those nine
//     chips in seven places, two of them word for word, and they render inches apart
//     on A10. "Always slightly late" survives the rule because early is a plan a crew
//     can make and late is a confession only a person can make.
//  2. **A tag that names the gathering it is read at is dead.** Tags are only ever
//     read inside one gathering (A22 opens from that gathering's people list), so
//     "sport" at a hockey game is true of nineteen thousand people. Taste survives
//     only as a handle — "here for the support act" — never as a category, which is
//     also what keeps these from being mistaken for W1's filter chips.
//  3. **Nothing everybody would tick.** "Here to meet people" was cut because every
//     person whose profile can be read has `open_to_meeting = true` — V1 requires it
//     of both parties — so it was true of 100% of the people who could ever see it.
//     "Easy company" was cut as unfalsifiable: nobody's self-assessment says
//     otherwise.
//
// **Why fifteen and not twenty** (Alex, M3.1): `person_tags.tag` references
// `tags.slug` with `on delete restrict`, so **adding a tag later is an insert and
// removing one anybody has picked is a data migration.** The two directions are not
// symmetric, so the safe error is short.
//
// **`not-drinking` is the load-bearing tag** — the only one that changes what a crew
// does (where it meets) rather than describing someone. Worth knowing when this list
// is next revisited.
//
// The slug is the contract and is one-way after the seed. The `name` is copy and can
// be changed here in an ordinary commit forever; the seed writes it to the table only
// so the table stays self-describing. The groups are display only — `public.tags` has
// no group column.
export const TAGS = [
  {
    group: "New here",
    tags: [
      { slug: "new-to-toronto", name: "new to Toronto" },
      { slug: "usually-go-alone", name: "usually go alone" },
      { slug: "first-time-at-this", name: "first time at this sort of thing" },
    ],
  },
  {
    group: "Company",
    tags: [
      { slug: "small-and-chatty", name: "small and chatty" },
      { slug: "dont-mind-the-quiet", name: "don't mind the quiet" },
      { slug: "happy-to-explain", name: "happy to explain things" },
      { slug: "not-drinking", name: "not drinking" },
    ],
  },
  {
    group: "What I'm like",
    tags: [
      { slug: "always-slightly-late", name: "always slightly late" },
      { slug: "will-talk-to-anyone", name: "will talk to anyone" },
      { slug: "up-for-whatever", name: "up for whatever" },
    ],
  },
  {
    group: "Bring me into",
    tags: [
      { slug: "sport-of-any-kind", name: "sport of any kind" },
      { slug: "games-and-puzzles", name: "games and puzzles" },
      { slug: "anything-outdoors", name: "anything outdoors" },
      { slug: "here-for-the-support-act", name: "here for the support act" },
      { slug: "will-try-what-im-bad-at", name: "will try the thing I'm bad at" },
    ],
  },
] as const;

export type TagSlug = (typeof TAGS)[number]["tags"][number]["slug"];

// Flat, in the order they are seeded and the order A3 shows them.
export const ALL_TAGS = TAGS.flatMap((g) => g.tags.map((t) => ({ ...t, group: g.group })));
