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
import { fromLocalInput, localDate } from "../admin/time.ts";

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

// ---------------------------------------------------------------------------
// The floor: the earliest instant a reader can still see on the site
//
// **Three times in one milestone, two pieces of code disagreed about which rows
// matter**, and every time it was invisible until one specific thing was missing:
//   - the venue-map pass and the admin's chip panel each wrote their own idea of "on
//     the public web" and counted rows RLS hides (fixed by asking the door — see
//     publicVenueIds in data.ts);
//   - the description pass started its window at `now` while W1 opens on the start of
//     today in the city, so **tonight's rows — the ones a reader is looking at — were
//     the ones that never got a line**, including the game Alex named.
//
// The windows themselves legitimately differ: the page shows a week, the publisher
// looks 21 days out, the map pass 28. What must not differ is the FLOOR. A job that
// exists to serve what is on the page has to start where the page starts, and that is
// one line of arithmetic that was being written three ways.
//
// So: one definition, used by W1's own window, by the description pass and by the map
// pass. The horizon stays each job's own business, because that part is a real
// difference rather than an accident.
export function readerFloor(now: Date, tz: string): Date {
  const today = localDate(now.toISOString(), tz);
  return new Date(fromLocalInput(`${today}T00:00`, tz)!);
}

// And the instant a given number of days after it, in the same zone — so a window is
// built from the same arithmetic at both ends.
export function daysAfterFloor(now: Date, tz: string, days: number): Date {
  const today = localDate(now.toISOString(), tz);
  return new Date(fromLocalInput(`${addDays(today, days)}T00:00`, tz)!);
}

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

// **What a card says about its crowd** (Alex, closing M2.3, and his call on the second
// clause rather than mine).
//
//   nobody yet        "0 pinned · be the first"
//   somebody          "3 pinned · see who's going"
//   crews forming     "12 pinned · crews forming · see who's going"
//
// I had made the second clause vary — the open-to-meeting count where there was one —
// on the grounds that one phrase repeated down two hundred rows is a slogan said at a
// reader rather than a fact about that gathering. **Alex took the argument and chose
// the invitation anyway**, in his words: "I'd rather every card invite a tap than have
// the second clause vary to stay interesting. Keep the counts as counts; the invitation
// is the invitation." Which is the right instinct about what a card is *for*: the count
// is information, and the tap is the point.
//
// Two things held from the version before it: the zero is never hidden — "be the first"
// sits beside the digit rather than instead of it (H6) — and "crews forming" keeps its
// place, because it is a state rather than a number, and the rarest and best thing a
// card can say. The open-to-meeting count moves to W2, where it has room.
export function crowdLine(g: CrowdCounts): string {
  // **Crew state belongs on the page you land on, not on the card** (Alex, closing
  // M2.3). "Crews forming" was the last thing on a card that was about our machinery
  // rather than about the reader: the count is the information, the tap is the point,
  // and what the crews are doing is on the other side of it.
  return g.pinned === 0
    ? `${plural(g.pinned, "pinned", "pinned")} · be the first`
    : `${plural(g.pinned, "pinned", "pinned")} · see who's going`;
}

// ---------------------------------------------------------------------------
// Token overlap against the title — measured, and deliberately NOT wired up
//
// Alex asked for a deterministic check that hides a line on a card when it is too close
// to the gathering's own name, on the correct principle that a prompt instruction has no
// floor under it. This is that check, and **the measurement says not to use it.** Kept
// here, with its numbers, so nobody builds it again from scratch.
//
// Over all 64 lines on the site, every single one at or above 40% overlap is a GOOD
// line:
//
//   63%  Toronto Maple Leafs vs. New York Islanders → NHL hockey, Maple Leafs host…
//   43%  Toronto Blue Jays vs. Reds                 → MLB baseball, Blue Jays host…
//   40%  Toronto Argonauts vs. BC Lions             → CFL football, Argonauts hosting…
//   67%  Thee Sacred Souls, LA LOM & The Womack…    → Soul group Thee Sacred Souls…
//   40%  KYLE WATSON                                → DJ set from house producer…
//
// while the two that really are restatements sit at **29%**: "Totally 2000's Video Dance
// Party" → "Dance party playing 2000s music videos and hits".
//
// **The metric is inversely useful on this data.** When a title already carries the
// proper nouns, the line's remaining words are the league or the genre — "NHL hockey",
// "MLB baseball", "soul group" — which is precisely the two words that answer "is it
// basketball?". A padded restatement, by contrast, avoids the title's words *because*
// it is padding. Any threshold that hides anything hides the best lines first.
//
// What would catch the real thing is a judgement about which new words are informative,
// which is the same kind of rule as a prompt instruction with my taxonomy instead of the
// model's — so the honest answer is that the restatement problem is small (2 of 64),
// the prompt already forbids it, and the admin's own edit is the fix for a line that
// slips through. Recorded in decisions.md.
// ---------------------------------------------------------------------------

const TITLE_STOP = new Set([
  "the", "and", "for", "with", "from", "this", "that", "their", "her", "his", "its",
  "are", "was", "were", "has", "have", "had", "will", "you", "your", "all", "any",
  "out", "off", "one", "two", "into", "onto", "over", "under", "about", "night",
  "live", "tour", "show", "presents", "featuring", "feat", "toronto",
]);

function meaningfulWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/['’]s/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !TITLE_STOP.has(w));
}

// The share of the line's own words that the title already had. 1 means the line says
// nothing the name did not.
export function titleOverlap(line: string, title: string): number {
  const inTitle = new Set(meaningfulWords(title));
  const words = meaningfulWords(line);
  if (words.length === 0) return 1;
  return words.filter((w) => inTitle.has(w)).length / words.length;
}
