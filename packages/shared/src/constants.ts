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
  // "Music", not "Live music" (Alex, M2.3): 15 of the 39 published Events rows are
  // Dance/Electronic club nights, and a DJ set is not live music. The feed cannot
  // tell a DJ night from a gig — the same rooms host both, measured — so the honest
  // move is the wider word, not a chip that claims a distinction we cannot make.
  // The stored value stays `live_music`: an identifier is not copy.
  { value: "live_music", label: "Music", tab: "events" },
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

// ---------------------------------------------------------------------------
// The two tabs (Alex, walking the community pages; M2.3 builds them)
// ---------------------------------------------------------------------------

// **Which tab a gathering is in is its source, so there is no editorial call per
// gathering.** Events is the Ticketmaster feed; Community is everything entered by
// hand and, later, everything the Community & free run finds (M4.4).
//
// This is not a second product. Community gatherings and big ticketed events share
// one structure, one pin, one crew: "a Leafs game and a run club differ only in what
// you are committing to" (Alex, after the community pass). The tabs exist because a
// fifty-row list needs a way in, and because the useful chips differ between the two
// halves — nothing more.
export const TABS = [
  { value: "events", label: "Events", path: "/" },
  { value: "community", label: "Community", path: "/community" },
] as const;

export type TabValue = (typeof TABS)[number]["value"];

export const tabForSource = (source: string): TabValue => (source === "ticketmaster" ? "events" : "community");

export const tabLabel = (value: TabValue): string => TABS.find((t) => t.value === value)!.label;

// The email sign-in code (A1, A27).
//
// **This number lives in two places and only one of them is this repo.** It must equal
// Supabase's **Authentication → Sign In / Providers → Email → Email OTP Length**. They
// started out disagreeing — Supabase sent 8, the screen accepted 6 — so a correct code
// could not be entered at all, and the screen simply refused it without saying why.
// Somebody looking at a valid code in their inbox concludes they mistyped it.
//
// The shape is FOLD_THRESHOLD's: a constant that one side of a boundary owns and the
// other has to match. It cannot be enforced from here, so instead the screen **says
// both numbers** when what it is given is the wrong length, which turns an invisible
// mismatch into a sentence naming the setting that is wrong.
export const EMAIL_CODE_LENGTH = 6;

// What to say when the code in somebody's hand is not the length we expect. Naming
// both numbers is the point: "that code is 8 digits, we expected 6" tells whoever
// reads it — the person, or us during a walk — exactly which setting disagrees.
export function codeLengthMismatch(given: number, expected = EMAIL_CODE_LENGTH): string {
  return `That code is ${given} digits and we expected ${expected}. Paste the whole thing — if it really is ${given} digits, tell us, because the setting is wrong at our end.`;
}
