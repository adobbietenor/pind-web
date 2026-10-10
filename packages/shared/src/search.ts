// M3.2b — search and interests: the rules both lists share (W1 and the app's A6/A7).
// Pure functions, so tests reach them (CLAUDE.md: a rule is not a component detail).

import { CATEGORIES, type TabValue } from "./constants.ts";
import type { Chip } from "./list.ts";

// ---------------------------------------------------------------------------
// Search (decisions, "A search bar"; built 10 Oct 2026)
// ---------------------------------------------------------------------------

// What the database matches at most; it caps the same way (m3_2b_public_gatherings_search).
export const SEARCH_MAX = 100;

// What was typed, as the one door will read it: trimmed, inner runs of space made one,
// capped. Blank is no search — the caller shows the list, not an empty result.
export function searchQuery(raw: string | null | undefined): string | null {
  const q = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX).trim();
  return q === "" ? null : q;
}

// Search looks through everything published ahead, not one week (Alex, 10 Oct 2026):
// someone looking for a show ten days out should find it. The publisher's lead (21 days
// for the feed) keeps Events near; recurring community rows run further, in date order.
export const SEARCH_DAYS = 400;

// PROPOSED copy (Tatiana's to reword). The empty result says what the site is — a
// selection, so most things are not here — and then offers two ways on, never a dead
// end (decisions, "A search bar": this week, and the suggest mailto with the query in it).
export const SEARCH_COPY = {
  label: "Search",
  placeholder: "Search by name or venue",
  found: (n: number, q: string) => `${n === 1 ? "1 gathering matches" : `${n} gatherings match`} “${q}”`,
  none: (q: string, city: string) =>
    `Nothing here matches “${q}”. Pin’d puts up a selection of what’s on in ${city} each week, so most things aren’t here.`,
  thisWeek: "See this week’s crowds",
  suggest: "Suggest it",
  clear: "Clear search",
} as const;

// Where "suggest a gathering" goes (spec §2 W1: a mailto, nothing stored). One address
// for W1's footer, W1's search and the app's (moved here from the Worker in M3.2b).
export const SUGGEST_TO = "crowds@pind.social";

// The suggest-a-gathering mailto, with what they looked for in the subject.
export const suggestSubject = (q: string): string => `A gathering for Pin'd: ${q}`;

// Interests that could not be remembered: the filter still works on this screen, and
// the person is told it will not be kept (never a tap that silently does nothing).
export const INTERESTS_NOT_SAVED = "We couldn’t remember that for next time — it still applies here.";

// ---------------------------------------------------------------------------
// Interests, remembered (Alex, M3.1; decided 10 Oct 2026)
//
// The remembered chips, applied to one tab's list. Separate from the tags: tags describe
// you to other people, interests only narrow what you see. **Narrowing, never
// reordering** (Q10): this decides which chips are on; applyChips does the narrowing and
// keeps the date order. **Only a chip on the row this week is applied** (Alex): a chip
// exists only where there are three gatherings in two places, so a remembered interest
// with no chip is resting — named, never applied — and the page can never be emptied by
// something remembered.
// ---------------------------------------------------------------------------

export interface InterestsHere {
  on: string[]; // remembered, offered on this tab this week: switched on
  resting: string[]; // remembered, belongs on this tab, no chip this week: named, not applied
}

export function interestsHere(remembered: readonly string[], offered: readonly Chip[], tab: TabValue): InterestsHere {
  const offeredHere = new Set(offered.map((c) => c.value));
  const on = offered.map((c) => c.value).filter((v) => remembered.includes(v));
  const resting = CATEGORIES.filter((c) => c.tab === tab && remembered.includes(c.value) && !offeredHere.has(c.value)).map(
    (c) => c.value,
  );
  return { on, resting };
}

// What to remember after a tap on this tab: the chips now on here, plus everything
// remembered that this tab did not offer (resting, or the other tab's) — a tap on Comedy
// never forgets Running. "Everything" is the one-tap clear: it forgets them all.
export function rememberAfter(remembered: readonly string[], offered: readonly Chip[], chosenHere: readonly string[]): string[] {
  const offeredHere = new Set(offered.map((c) => c.value));
  const kept = remembered.filter((v) => !offeredHere.has(v));
  const next = new Set([...kept, ...chosenHere]);
  return CATEGORIES.map((c) => c.value).filter((v) => next.has(v));
}

// PROPOSED copy (Tatiana's to reword). Visibly on, with the way off in the same line
// (build plan: "a default-on filter that hides things is a new way to see an empty week").
export const INTERESTS_COPY = {
  on: "Showing your interests",
  resting: (labels: string[]) => `${labels.join(", ")}: not enough on this week`,
  showEverything: "Show everything",
} as const;
