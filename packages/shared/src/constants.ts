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
  { value: "live_music", label: "Live music" },
  { value: "sport", label: "Sport" },
  { value: "comedy", label: "Comedy" },
  // Working label. "Doing" was the right concept and the wrong word next to "Live
  // music" and "Sport"; this line is the whole cost of changing it.
  { value: "taking_part", label: "Take part" },
  { value: "markets", label: "Markets & street" },
] as const;

export type CategoryValue = (typeof CATEGORIES)[number]["value"];

export const categoryLabel = (value: string | null | undefined): string =>
  CATEGORIES.find((c) => c.value === value)?.label ?? "";
