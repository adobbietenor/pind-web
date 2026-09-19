// DRAFT tag list (Alex, M2.0). The wording is Tatiana's to change freely until
// M3.1 seeds public.tags. After the seed, changing the list costs a data
// migration, because profiles point at tag slugs (person_tags.tag references
// tags.slug). M3.1 owns the final list and the seed migration. public.tags is
// unseeded today, and it has no group column; the groups are display only.
//
// Tags are conversation handles, not match criteria (spec A3).
export const TAGS_DRAFT = [
  {
    group: "Anyone, anywhere",
    tags: [
      { slug: "new-to-toronto", name: "new to Toronto" },
      { slug: "usually-go-alone", name: "usually go alone" },
      { slug: "first-timer-friendly", name: "first-timer friendly" },
      { slug: "no-small-talk", name: "no small talk" },
      { slug: "not-drinking", name: "not drinking" },
    ],
  },
  {
    group: "Sports",
    tags: [
      { slug: "post-game-pints", name: "post-game pints" },
      { slug: "loud-in-the-300s", name: "loud in the 300s" },
      { slug: "away-game-bars", name: "away-game bars" },
      { slug: "season-splitter", name: "season splitter" },
      { slug: "happy-to-explain-the-rules", name: "happy to explain the rules" },
    ],
  },
  {
    group: "Music",
    tags: [
      { slug: "live-music", name: "live music" },
      { slug: "techno", name: "techno" },
      { slug: "hip-hop", name: "hip-hop" },
      { slug: "know-every-word", name: "know every word" },
      { slug: "down-the-front", name: "down the front" },
    ],
  },
  {
    group: "How you do a night",
    tags: [
      { slug: "early-arriver", name: "early arriver" },
      { slug: "one-drink-then-in", name: "one drink then in" },
      { slug: "stay-to-the-end", name: "stay to the end" },
      { slug: "patio-before", name: "patio before" },
      { slug: "run-clubs-and-markets", name: "run clubs and markets" },
    ],
  },
] as const;

export type TagSlug = (typeof TAGS_DRAFT)[number]["tags"][number]["slug"];
