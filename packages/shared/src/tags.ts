// The tag list (Alex, after walking A3 in M3.1 — this replaces the fifteen seeded
// earlier the same day, reseeded by `20260921130537_m3_1_tags_v2`).
//
// **Tags are conversation handles, not match criteria** (spec A3). There is no
// matching anywhere in Pin'd.
//
// **Why it changed.** The fifteen skewed toward newcomers — new here, first time at
// this, usually go alone — and the product is as much for somebody who has lived here
// ten years and wants a good night out. This list **weights personality over
// circumstance**, and puts the locals and the newcomers side by side in one small
// group rather than making arrival the main thing a profile says.
//
// `not-drinking` and `enjoys-a-drink` are a deliberate pair, like the opposites
// elsewhere: both tell somebody something useful before they meet, and a list with
// only the first one makes drinking the default and abstaining the declaration.
//
// **The rules, and where each one lives:**
//
//   at least three   the A3 screen, and **never the database** — the link path pins
//                    with no tags at all, so a minimum in the database would make a
//                    pin impossible.
//   up to ten        the database (`person_tags_within_caps`), because a screen's
//                    rule is one a session token walks around.
//   three on a list  the person chooses which (`person_tags.on_list`). Not a
//                    visibility rule: every tag is readable by anyone V19 allows, and
//                    the profile behind the list shows all of them.
//
// The maximum is not advertised, but an eleventh tap says so — a control that
// silently ignores you looks broken.
//
// The slug is the contract and is one-way once anybody has picked it; the `name` is
// copy and can change here in an ordinary commit forever.
export const TAGS = [
  {
    group: "Company",
    tags: [
      { slug: "chatty", name: "chatty" },
      { slug: "will-talk-to-anyone", name: "will talk to anyone" },
      { slug: "good-listener", name: "good listener" },
      { slug: "dont-mind-the-quiet", name: "don't mind the quiet" },
      { slug: "takes-a-minute-to-warm-up", name: "takes a minute to warm up" },
      { slug: "happy-to-explain", name: "happy to explain things" },
      { slug: "the-hype-person", name: "the hype person" },
      { slug: "will-introduce-you-to-everyone", name: "will introduce you to everyone" },
      { slug: "knows-all-the-good-spots", name: "knows all the good spots" },
      { slug: "always-looking-for-new-friends", name: "always looking for new friends" },
    ],
  },
  {
    group: "What I'm like",
    tags: [
      { slug: "up-for-whatever", name: "up for whatever" },
      { slug: "will-try-anything-once", name: "will try anything once" },
      { slug: "first-on-the-dance-floor", name: "first on the dance floor" },
      { slug: "loud-in-the-best-way", name: "loud in the best way" },
      { slug: "competitive-about-everything", name: "competitive about everything" },
      { slug: "overthinks-the-plan", name: "overthinks the plan" },
      { slug: "always-slightly-late", name: "always slightly late" },
      { slug: "terrible-with-names", name: "terrible with names" },
      { slug: "asks-too-many-questions", name: "asks too many questions" },
      { slug: "will-make-friends-with-the-bouncer", name: "will make friends with the bouncer" },
    ],
  },
  {
    group: "Interests",
    tags: [
      { slug: "live-music", name: "live music" },
      { slug: "club-nights", name: "club nights" },
      { slug: "sport-of-any-kind", name: "sport of any kind" },
      { slug: "games-and-puzzles", name: "games and puzzles" },
      { slug: "anything-outdoors", name: "anything outdoors" },
      { slug: "comedy", name: "comedy" },
      { slug: "here-for-the-support-act", name: "here for the support act" },
    ],
  },
  {
    group: "Good to know",
    tags: [
      { slug: "not-drinking", name: "not drinking" },
      { slug: "enjoys-a-drink", name: "enjoys a drink" },
      // **Generic slugs, city-specific words** (Alex, M3.1). The slug is the
      // contract and is one-way; the name is copy. So Vancouver gets "new to
      // Vancouver" in a commit rather than a data migration — which is the point
      // of the city being a row on `cities` rather than a string in a page.
      { slug: "born-and-raised", name: "Toronto born and raised" },
      { slug: "new-in-town", name: "new to Toronto" },
      { slug: "usually-go-alone", name: "usually go alone" },
    ],
  },
] as const;

export type TagSlug = (typeof TAGS)[number]["tags"][number]["slug"];

// Flat, in the order they are seeded and the order A3 shows them.
export const ALL_TAGS = TAGS.flatMap((g) => g.tags.map((t) => ({ ...t, group: g.group })));

// What the screen asks for, and what the database allows. They are different numbers
// on purpose: see the header.
export const TAGS_MINIMUM = 3;
export const TAGS_MAXIMUM = 10;
// How many show on the "going & open to meeting" row, chosen by the person.
export const TAGS_ON_LIST = 3;

// Said only when somebody reaches for an eleventh. The maximum is not advertised —
// but a tap that does nothing looks broken, which is the fault the code field had.
export const TAGS_AT_MAXIMUM = `That's ${TAGS_MAXIMUM}, which is as many as a profile carries. Take one off to add another.`;
export const TAGS_LIST_FULL = `Three is what fits on the list. Take one off to feature a different one — the rest still show on your profile.`;

// ---------------------------------------------------------------------------
// The picker's rules, here rather than in the component (M3.1).
//
// **They moved because they could not be tested where they were.** They lived in
// `app/src/components/TagPicker.tsx`, which imports React Native and therefore cannot
// be loaded by `node --test` — so the eleventh-tap refusal, which exists precisely to
// stop a tap doing nothing silently, had nothing proving it fires. The database half
// has P77; this is the half a person actually sees.
//
// Same move as `ageOn`: a rule is not a component detail just because a component is
// the only thing that calls it.
// ---------------------------------------------------------------------------

export interface PickedTag {
  slug: string;
  onList: boolean;
}

export function countOnList(picked: readonly PickedTag[]): number {
  return picked.filter((p) => p.onList).length;
}

export function enoughPicked(picked: readonly PickedTag[]): boolean {
  return picked.length >= TAGS_MINIMUM;
}

// Adding or removing one. Tapping a tag you already have takes it off — there is no
// separate remove, because a chip that is on and a chip that is off are the same
// control.
export function toggleTag(picked: readonly PickedTag[], slug: string): { next: PickedTag[]; says?: string } {
  const have = picked.find((p) => p.slug === slug);
  if (have) return { next: picked.filter((p) => p.slug !== slug) };
  // **The refusal says so.** The maximum is not advertised, but a tap that silently
  // does nothing looks broken — the same fault the code field had when it swallowed
  // two digits of a pasted code.
  if (picked.length >= TAGS_MAXIMUM) return { next: [...picked], says: TAGS_AT_MAXIMUM };
  // The first three picked are the first three shown, so somebody who never opens the
  // second row still has a sensible row rather than a blank one.
  return { next: [...picked, { slug, onList: countOnList(picked) < TAGS_ON_LIST }] };
}

// Moving one on or off the list of three that shows beside a name.
export function toggleOnList(picked: readonly PickedTag[], slug: string): { next: PickedTag[]; says?: string } {
  const have = picked.find((p) => p.slug === slug);
  if (!have) return { next: [...picked] };
  if (!have.onList && countOnList(picked) >= TAGS_ON_LIST) return { next: [...picked], says: TAGS_LIST_FULL };
  return { next: picked.map((p) => (p.slug === slug ? { ...p, onList: !p.onList } : p)) };
}
