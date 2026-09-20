// Crews open when this many people at one gathering opt in to meeting (spec §0, §5).
export const THRESHOLD = 5;

// A complete profile has exactly this many tags (spec A3). Never a gate before a pin.
export const TAGS_PER_PROFILE = 3;

// The chips a reader filters the list by (Alex, after the community pass, 20 Sep
// 2026). The value is the stored identifier and never changes; the label is copy and
// can. They are deliberately NOT the buckets the publisher's category cap works on —
// that is a different job on a different vocabulary, and merging the two would take a
// week from 23 published to 6 (measured).
//
// The order is the order they appear. Null is unclassified and still visible, because
// unfiltered is the default: only a chip can hide a row.
export const CATEGORIES = [
  { value: "live_music", label: "Live music", tab: "events" },
  { value: "sport", label: "Sport", tab: "events" },
  { value: "comedy", label: "Comedy", tab: "events" },
  { value: "games", label: "Games", tab: "community" },
  { value: "cycling", label: "Cycling", tab: "community" },
  { value: "running", label: "Running", tab: "community" },
  { value: "outdoors", label: "Outdoors", tab: "community" },
  { value: "markets", label: "Markets & street", tab: "community" },
] as const;

export type CategoryValue = (typeof CATEGORIES)[number]["value"];
export type CategoryTab = (typeof CATEGORIES)[number]["tab"];

// When a chip earns its place. Two tests, because one was wrong: a venue count alone
// would have hidden **running**, which is four clubs and fifty-nine dated rows — the
// busiest chip after games — simply because they meet at only two places. Constant
// fixtures in two places are exactly what somebody filtering for a run club wants.
//
// So: at least three distinct gatherings to choose between, in at least two places.
// "Reading & talking" fails on both — two book clubs at one library, where filtering
// showed east Scarborough or nothing, which is worse than no chip for everyone else
// (Alex, after the wider community pass).
//
// Below the bar the gatherings still appear: unfiltered is the default, and only a
// chip can hide a row.
export const CHIP_MIN_GATHERINGS = 3;
export const CHIP_MIN_VENUES = 2;

export const categoryLabel = (value: string | null | undefined): string =>
  CATEGORIES.find((c) => c.value === value)?.label ?? "";
