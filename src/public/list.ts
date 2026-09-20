// W1's arithmetic: which tab, which chips, which days, and which week.
//
// Pure — no network, no HTML, no Supabase — so the unit tests load it directly in
// Node, the same reason map.ts and admin/time.ts are written this way. The shared
// constants come in by path rather than through "@pind/shared" for that reason only;
// they are still the one copy in packages/shared, never retyped.
//
// **Nothing here decides visibility.** Every row it is handed is already public:
// published, not withdrawn, not seeded, carrying a slug — the database's own single
// definition of "on the public web", read through public_gatherings (M2.1, H11). What
// follows narrows a public list because a reader asked it to. It can never widen one,
// and there is no branch below that could show a person: W1 shows gatherings.

import {
  CATEGORIES,
  CHIP_MIN_GATHERINGS,
  CHIP_MIN_VENUES,
  TABS,
  tabForSource,
  type TabValue,
} from "../../packages/shared/src/constants.ts";
import { localDate } from "../admin/time.ts";

export { TABS, tabForSource, type TabValue };

// Only the fields the arithmetic needs. data.ts's Crowd has these and more, so it
// fits without being imported (which would drag supabase-js into the tests).
export interface ListRow {
  starts_at: string;
  source: string;
  category: string | null;
  venue_id: string;
  name: string;
  city_timezone: string;
}

// ---------------------------------------------------------------------------
// The window: a week at a time
// ---------------------------------------------------------------------------

// Seven days, and the page says so. At fifty a week the whole published horizon is
// 112 rows today and over 200 once the publisher is full — 60 KB of HTML on a page
// whose entire budget is one second inside a Reddit tab, where today's crowd page is
// 78 KB including its map. A week is about fifty cards and always has something under
// today and tomorrow, which is what the lead minimum of 0 exists to produce.
export const WINDOW_DAYS = 7;

export const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ListWindow {
  // City-local calendar dates: the first day shown and the first day not shown.
  start: string;
  end: string;
  // Today, in the city — so the page can say "Today" and refuse to page backwards
  // before it.
  today: string;
  // What the reader asked for, once it has been checked. Null means "from today",
  // which is what "/" always means however long this browser tab has been open.
  asked: string | null;
}

// A ?from= that is not a date, or is in the past, is treated as no ?from= at all: a
// stale link in a Reddit thread should open on this week rather than on a page of
// gatherings that have already happened.
export function windowFor(now: Date, tz: string, from: string | null | undefined): ListWindow {
  const today = localDate(now.toISOString(), tz);
  const asked = from && DATE.test(from) && from > today ? from : null;
  const start = asked ?? today;
  return { start, end: addDays(start, WINDOW_DAYS), today, asked };
}

// ---------------------------------------------------------------------------
// The tabs
// ---------------------------------------------------------------------------

export const rowsInTab = <T extends ListRow>(rows: T[], tab: TabValue): T[] =>
  rows.filter((r) => tabForSource(r.source) === tab);

// ---------------------------------------------------------------------------
// The chips
//
// A chip appears when there are three things to choose between, in more than one
// place (CHIP_MIN_GATHERINGS, CHIP_MIN_VENUES). Two rules follow from computing that
// over the rows actually on the page rather than over a fixed table:
//
//   - **no chip can ever filter to an empty page**, because it was counted from what
//     is there;
//   - **no chip advertises an absence** — "Community (0)" every day is a chip that
//     tells a reader only that we have nothing (Alex, M2.2, for M2.3).
//
// Counted before any chip is applied, so tapping one never removes the others.
// Distinct gatherings, not rows: four Frontrunners runs a week are one thing to
// choose between, and counting rows would let one recurring fixture conjure a chip.
// ---------------------------------------------------------------------------

export interface Chip {
  value: string;
  label: string;
  // What it would show. Not printed today — the chips read as a browse aid, not a
  // scoreboard — but it is what the admin's readout needs, and what proves the bar.
  gatherings: number;
  venues: number;
}

export function chipsFor(rows: ListRow[], tab: TabValue): Chip[] {
  const seen = new Map<string, { names: Set<string>; venues: Set<string> }>();
  for (const r of rowsInTab(rows, tab)) {
    if (!r.category) continue;
    let e = seen.get(r.category);
    if (!e) seen.set(r.category, (e = { names: new Set(), venues: new Set() }));
    e.names.add(r.name);
    e.venues.add(r.venue_id);
  }
  // CATEGORIES order, and its label. A category is offered in whichever tab has the
  // rows for it: `tab` there is where it is expected to live, not a gate. An open mic
  // entered by hand is Community and is music, and if three of them turn up in two
  // places a Music chip on Community is the right answer, not a bug.
  return CATEGORIES.filter((c) => {
    const e = seen.get(c.value);
    return e !== undefined && e.names.size >= CHIP_MIN_GATHERINGS && e.venues.size >= CHIP_MIN_VENUES;
  }).map((c) => ({
    value: c.value,
    label: c.label,
    gatherings: seen.get(c.value)!.names.size,
    venues: seen.get(c.value)!.venues.size,
  }));
}

// Everything with a category in this tab that did NOT earn a chip, for the admin to
// read. On the page these rows are simply there, unfiltered like everything else.
export function belowTheBar(rows: ListRow[], tab: TabValue): Chip[] {
  const earned = new Set(chipsFor(rows, tab).map((c) => c.value));
  const counts = new Map<string, { names: Set<string>; venues: Set<string> }>();
  for (const r of rowsInTab(rows, tab)) {
    if (!r.category || earned.has(r.category)) continue;
    let e = counts.get(r.category);
    if (!e) counts.set(r.category, (e = { names: new Set(), venues: new Set() }));
    e.names.add(r.name);
    e.venues.add(r.venue_id);
  }
  return CATEGORIES.filter((c) => counts.has(c.value)).map((c) => ({
    value: c.value,
    label: c.label,
    gatherings: counts.get(c.value)!.names.size,
    venues: counts.get(c.value)!.venues.size,
  }));
}

// Multi-select: `?c=games,running` is the union of the two, never the intersection —
// somebody who taps Games and Running wants both evenings, not the evenings that are
// somehow both. A value that did not earn a chip on this page is dropped rather than
// honoured, so a hand-edited or out-of-date URL cannot produce an empty list.
export function parseChips(raw: string | null | undefined, offered: Chip[]): string[] {
  if (!raw) return [];
  const allowed = new Set(offered.map((c) => c.value));
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (allowed.has(v) && !out.includes(v)) out.push(v);
  }
  // Every chip selected is deliberately NOT collapsed to "unfiltered", although it
  // looks like the same list: unfiltered also shows the rows nobody has classified,
  // and every chip at once does not. Collapsing them would quietly add rows a reader
  // had filtered out.
  return out;
}

// **A filter that narrows, never a sort that reorders** (Alex, M2.2): this only ever
// drops rows, and the order of what is left is exactly the order it arrived in — by
// date, never by size (Q10). There is no branch here that could become a ranking.
export const applyChips = <T extends ListRow>(rows: T[], chips: string[]): T[] =>
  chips.length === 0 ? rows : rows.filter((r) => r.category !== null && chips.includes(r.category));

// ---------------------------------------------------------------------------
// The days
// ---------------------------------------------------------------------------

export interface DayGroup<T> {
  date: string;
  // "Today", "Tomorrow", or "Saturday 26 September".
  label: string;
  // Today and tomorrow carry the date underneath as well, so the page never leaves a
  // reader wondering what "Today" was when the tab was opened an hour ago.
  sub: string | null;
  rows: T[];
}

// A calendar date is a calendar date: it is formatted as UTC from its own parts, so
// no zone can shift "Saturday 26 September" onto the Friday. The rows were bucketed
// into this date using the venue's zone; naming it is separate arithmetic.
// en-GB, because "Saturday 26 September" is how this product writes a date
// everywhere else, and en-CA renders "Saturday, September 26".
const FULL = (date: string): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${date}T00:00:00Z`),
  );

// Grouped by the venue's own calendar day, in the order the rows arrived — which is
// by date (Q10). A day with nothing in it is not printed: the list is what is on,
// not a calendar with holes.
export function dayGroups<T extends ListRow>(rows: T[], tz: string, today: string): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  const index = new Map<string, DayGroup<T>>();
  for (const r of rows) {
    const date = localDate(r.starts_at, r.city_timezone || tz);
    let g = index.get(date);
    if (!g) {
      const tomorrow = addDays(today, 1);
      const named = date === today ? "Today" : date === tomorrow ? "Tomorrow" : null;
      g = { date, label: named ?? FULL(date), sub: named ? FULL(date) : null, rows: [] };
      index.set(date, g);
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Links
//
// Every control on this page is a link with query parameters, rendered by the server.
// No client-side JavaScript, no framework, no router: the page has to open inside a
// Reddit tab in under a second, and a filter that needs a bundle to work is a filter
// that costs the whole budget (CLAUDE.md, "Keep the Worker lean").
// ---------------------------------------------------------------------------

export function href(path: string, chips: string[], from: string | null): string {
  const q: string[] = [];
  if (chips.length) q.push(`c=${chips.join(",")}`);
  if (from) q.push(`from=${from}`);
  return q.length ? `${path}?${q.join("&")}` : path;
}

// Tapping a chip adds it; tapping it again takes it away. Paging position is kept —
// filtering next week should stay on next week.
export function toggle(chips: string[], value: string): string[] {
  return chips.includes(value) ? chips.filter((c) => c !== value) : [...chips, value];
}

// The other tab, with the same week. Chips are deliberately NOT carried across:
// they are counted per tab and mean different things in each, so a "Running" chip
// followed into Events would be a filter for something that tab does not have
// (Alex: chips filter within a tab, never across).
export const tabHref = (tab: TabValue, from: string | null): string =>
  href(TABS.find((t) => t.value === tab)!.path, [], from);

// ---------------------------------------------------------------------------
// What a card says about its crowd
// ---------------------------------------------------------------------------

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Only the three numbers the line reads. data.ts's Crowd has them and more.
export interface CrowdCounts {
  pinned: number;
  open_to_meeting: number;
  crews_open: boolean;
}

// **What a card says about its crowd, in all three states** (Alex, closing M2.3: taking
// the threshold out was right, and leaving "0 pinned" alone overshot — it reads as dead
// rather than as early).
//
//   nobody yet        "0 pinned · be the first"
//   some, none open   "3 pinned"
//   some, open        "3 pinned · 1 open to meeting"
//   crews forming     "12 pinned · crews forming"
//
// Two things it deliberately does not do:
//   - **it never hides the zero.** "Be the first" alone would have read better and said
//     less; the digit stays because small counts are shown, never hidden, including
//     zero (H6, spec §2 W1), and "be the first" is the invitation next to it rather
//     than instead of it. It is also the phrase A5–A7 already use for this state.
//   - **it does not put "see who's going" on every row.** That was the option, and it
//     has the same failure as the line it replaced: two hundred rows repeating one
//     phrase is a slogan being said at a reader rather than anything about that
//     gathering, and the page already says it once, at the top. What a reader actually
//     wants to know is whether there is anybody to meet — so the second clause is the
//     open-to-meeting count where there is one, which is a fact and is different on
//     every row.
export function crowdLine(g: CrowdCounts): string {
  const parts = [plural(g.pinned, "pinned", "pinned")];
  if (g.pinned === 0) parts.push("be the first");
  else if (g.crews_open) parts.push("crews forming");
  else if (g.open_to_meeting > 0) parts.push(plural(g.open_to_meeting, "open to meeting", "open to meeting"));
  return parts.join(" · ");
}
