// W1–W3 and the small public routes around them (spec §2).
//
// Everything here reads through src/public/data.ts, which reads through the anon key
// and the two public_* database functions. No page filters anything itself (H11).

import { categoryLabel, CITY_ATTRIBUTION, clockLocal, COUNTERS, countNext, entryLine, longWhenLocal, pinNote, WHO_ELSE, CROWD_PAGE_COPY, HOUSE_RULES, ONE_LINER, PIN_IN, pinnedMarker, SEARCH_COPY, SEARCH_DAYS, SEARCH_MAX, searchQuery, SAFETY_TODAY, SEE_WHO, SUGGEST_TO, suggestSubject, THRESHOLD_EXPLANATION } from "@pind/shared";
import type { Env } from "../env";
import { DEFAULT_TZ, fromLocalInput, localDate } from "../admin/time";
import { faviconSvg } from "./favicon";
import { city, crowd, crowds, type Counts, type Crowd, type Crowd2, type Spot } from "./data";
import { DOT, escape, header, houseRulesRow, icon, notice, page } from "./layout";
import {
  addDays,
  crowdLine,
  plural,
  applyChips,
  CHIP_ALL,
  chipsFor,
  dayGroups,
  href,
  parseChips,
  readerFloor,
  rowsInTab,
  TABS,
  tabHref,
  toggle,
  windowFor,
  WINDOW_DAYS,
  type Chip,
  type DayGroup,
  type TabValue,
  type ListWindow,
} from "./list";
import { venueDirections, venueMap, walkMinutes } from "./map";
import { ensureVenueMap } from "./mapserve";
import { chooseZoom, isReady, mapKey, mapUrl, place, uploadUrl, type Placed } from "./venuemap";

// Where "suggest a gathering" and "report" go. Nothing is stored (spec §2 W1):
// it is a mailto and no more. SUGGEST_TO lives in packages/shared since M3.2b, where
// the app's search uses it too.
const REPORT_TO = "safety@pind.social";

// ---------------------------------------------------------------------------
// Time, in the venue's city
// ---------------------------------------------------------------------------

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...opts }).format(new Date(iso));
}

// The card's clock is the shared one, so the app's list says the same time (M3.3c).
const clock = clockLocal;

// The house date and clock, shared with the app's A8/A9 (packages/shared, longWhenLocal).
const longWhen = longWhenLocal;

// ---------------------------------------------------------------------------
// Counts, said honestly (H6). Zero is a number and it is shown.
// ---------------------------------------------------------------------------

// **The threshold is our mechanic, not the reader's reason** (Alex, after the M2.3
// walk, and he had never liked the old line). "Crews open at 5" describes a rule
// somebody is waiting on; what they came for is to see who else is going. So the
// number never leads anywhere:
//
//   - W2's counts sit under the heading "Who else is going?" and the threshold is a
//     quiet line beneath them, in the fixed wording from packages/shared;
//   - a card on W1 says what is true — "3 pinned", and "crews forming" only when they
//     are. A row that has not reached five now says nothing about five, because a
//     hundred rows all saying "crews open at 5" was the rule being repeated at a
//     reader rather than anything about that gathering;
//   - the pinned page in M3.3 leads with "Find your crew", where forming one is
//     genuinely the next action (Alex; recorded for A9/A10).
// #14 (29 Oct 2026): the signal stays (`crews_open`, 5+ open to meeting — a lively one);
// the words were the crew design's, retired on 28 Sept. PROPOSED copy.
function crewLine(c: { crews_open: boolean }): string {
  return c.crews_open ? "people meeting up" : "";
}


// The mix appears only at 5+ opted in, and "Other" only above zero (Q3, V3).
function mixLine(counts: Counts): string {
  if (counts.women === null || counts.men === null) return "";
  const parts = [`${counts.women} women`, `${counts.men} men`];
  if (counts.other !== null && counts.other > 0) parts.push(`${counts.other} other`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// W1 — This week's crowds
// ---------------------------------------------------------------------------

// **The back button, and what should be in the history** (Alex, after the walk).
//
// Every control on this page is a link, which is what keeps the page server-rendered
// and working with JavaScript off — and it meant that four chip taps left four
// entries, so "back" walked through a filter state nobody was trying to return to.
//
//   - **the tab and the chips replace the current entry.** They are query-parameter
//     state on one page, not places you went. So the whole visit to the list is one
//     entry, and back from it leaves for wherever you arrived from;
//   - **the pager and the cards push.** Next week is somewhere else, and so is a
//     crowd page. Back from a crowd page lands on the list exactly as it was, chips
//     and week included, because that URL carries all of it.
//
// Progressive enhancement, and the page is complete without it: with JavaScript off
// every one of these is still an ordinary link that works, it simply also leaves a
// history entry. Modifier clicks and middle clicks are left alone so "open in a new
// tab" still does what it always did.
const REPLACE_SCRIPT =
  `try{var n=document.querySelectorAll("a[data-replace]");` +
  `for(var i=0;i<n.length;i++)n[i].addEventListener("click",function(e){` +
  `if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;` +
  `e.preventDefault();location.replace(this.href)});}catch(e){}`;

const W1_FOOTER =
  `<a href="mailto:${SUGGEST_TO}?subject=A%20gathering%20for%20Pin%27d">suggest a gathering</a>` +
  `${DOT}<a href="/about">about</a>${DOT}19+`;

// The licence line the City feed requires, wherever one of its listings is on the page
// (M4.4). A link of our own origin's style; the licence page itself is the City's.
const CITY_LINE = `<br><a href="${CITY_ATTRIBUTION.href}" rel="license">${escape(CITY_ATTRIBUTION.text)}</a>`;
const withCityLine = (footer: string, rows: { source: string }[]) =>
  rows.some((r) => r.source === "city") ? footer + CITY_LINE : footer;

// The window the list is read over: the week being shown, plus the week after it so
// the pager knows whether there is anything later to point at. One round trip.
const READ_WEEKS = 2;

// W1 — the landing page, one tab and one week at a time.
//
// Four controls, all of them server-rendered links with query parameters: the tab,
// the chips, and the two ends of the pager. No client-side JavaScript at all, because
// this page is pasted into Reddit threads and has to open inside Reddit's in-app
// browser in under a second (CLAUDE.md, "Keep the Worker lean").
export async function w1(request: Request, env: Env, tab: TabValue): Promise<Response> {
  const url = new URL(request.url);
  // The label above the list, from the `cities` row (M3.1). W1 serves both tabs, so
  // Events and Community get it together; a crowd page does not, because it is
  // already about one place.
  const place = await city(env);
  const now = new Date();
  const win = windowFor(now, DEFAULT_TZ, url.searchParams.get("from"));

  // Local midnight to local midnight, in the city's own zone: a Friday night show at
  // 11pm belongs to Friday, and a week boundary in Toronto is not one in UTC.
  //
  // When the reader has not asked for a particular week this is readerFloor — the same
  // floor the description and map passes use, so no job can disagree with the page
  // about which rows a reader can see (list.ts).
  const from = win.asked
    ? new Date(fromLocalInput(`${win.start}T00:00`, DEFAULT_TZ)!)
    : readerFloor(now, DEFAULT_TZ);
  const to = new Date(fromLocalInput(`${addDays(win.start, WINDOW_DAYS * READ_WEEKS)}T00:00`, DEFAULT_TZ)!);
  const all = await crowds(env, from, to);

  // This week's rows, in both tabs, before any chip is applied. The chips are counted
  // from these, so a chip can never filter to an empty page.
  const thisWeek = all.filter((g) => localDate(g.starts_at, g.city_timezone) < win.end);
  const mine = rowsInTab(thisWeek, tab);
  const offered = chipsFor(thisWeek, tab);
  const chips = parseChips(url.searchParams.get("c"), offered);
  const shown = applyChips(mine, chips);

  const path = TABS.find((t) => t.value === tab)!.path;
  const other = TABS.find((t) => t.value !== tab)!;
  const otherCount = rowsInTab(thisWeek, other.value).length;
  // Next week, **in this tab**. Counted per tab because the pager is per tab: the
  // Ticketmaster feed stops at the 21-day lead window while the recurrence generator
  // runs community rows months out, so a "later" link counted across both tabs sends
  // an Events reader to an empty week — which is worse than no link.
  const later = rowsInTab(
    all.filter((g) => localDate(g.starts_at, g.city_timezone) >= win.end),
    tab,
  );

  const origin = url.origin;
  const body = shown.length
    ? dayGroups(shown, DEFAULT_TZ, win.today)
        .map((d) => dayHeading(d) + d.rows.map(card).join(""))
        .join("")
    : emptyWeek(tab, other, otherCount, win);

  return page(
    `${header(place)}
<h1>${escape(tab === "community" ? "Community this week" : "This week’s crowds")}</h1>
<p class="lede">${escape(ONE_LINER)}</p>
${searchForm(null)}
${tabs(tab, win)}
${chipRow(path, offered, chips, win)}
${weekLine(win)}
${body}
${pager(path, chips, win, later.length)}`,
    {
      title: tab === "community" ? "Community · Pin'd" : "This week's crowds · Pin'd",
      description: ONE_LINER,
      // The unfiltered tab, whatever is being filtered or paged: the canonical page
      // is the one worth sharing.
      canonical: `${origin}${path}`,
      footer: withCityLine(W1_FOOTER, shown),
      script: REPLACE_SCRIPT,
    },
  );
}

// ---------------------------------------------------------------------------
// Search (M3.2b; decisions, "A search bar")
//
// **No client JavaScript**: a GET form is a navigation, so the magnifying glass submits
// and the Worker renders /search?q=… with W1's own cards. Works with scripting off, adds
// nothing to W1's bytes but the form. **One door**: crowds() with a query — the database
// narrows, and nothing here can return what the list would not (P191–P192).
// ---------------------------------------------------------------------------

function searchForm(q: string | null): string {
  return `<form class="search" action="/search" method="get" role="search"><input type="search" name="q" aria-label="${escape(SEARCH_COPY.label)}" placeholder="${escape(SEARCH_COPY.placeholder)}" maxlength="${SEARCH_MAX}" enterkeyhint="search" autocomplete="off"${q ? ` value="${escape(q)}"` : ""}><button type="submit">${escape(SEARCH_COPY.label)}</button></form>`;
}

// Everything published ahead, in date order (Alex, 10 Oct 2026), grouped by day like
// W1. Blank goes back to the list rather than showing an empty search.
export async function searchPage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = searchQuery(url.searchParams.get("q"));
  if (!q) return Response.redirect(`${url.origin}/`, 302);
  const place = await city(env);
  const now = new Date();
  const today = localDate(now.toISOString(), DEFAULT_TZ);
  const to = new Date(fromLocalInput(`${addDays(today, SEARCH_DAYS)}T00:00`, DEFAULT_TZ)!);
  const found = await crowds(env, readerFloor(now, DEFAULT_TZ), to, undefined, q);
  const cityName = place?.name ?? "Toronto";

  const body = found.length
    ? `<p class="found">${escape(SEARCH_COPY.found(found.length, q))}</p>` +
      dayGroups(found, DEFAULT_TZ, today)
        .map((d) => dayHeading(d) + d.rows.map(card).join(""))
        .join("")
    : `<div class="empty">${escape(SEARCH_COPY.none(q, cityName))} <a href="/">${escape(SEARCH_COPY.thisWeek)}.</a> <a href="mailto:${SUGGEST_TO}?subject=${encodeURIComponent(suggestSubject(q))}">${escape(SEARCH_COPY.suggest)}.</a></div>`;

  return page(
    `${header(place)}
<h1>${escape(SEARCH_COPY.label)}</h1>
${searchForm(q)}
${body}`,
    {
      title: `${q} · Pin'd`,
      description: ONE_LINER,
      canonical: `${url.origin}/`,
      footer: withCityLine(W1_FOOTER, found),
    },
  );
}

// Two tabs, always both, even when one of them is empty this week. They are the shape
// of the page, not a result of the data: hiding one would move everything else on the
// page depending on what Toronto happened to have on, and a reader who came for the
// run clubs would find no way to ask for them.
function tabs(current: TabValue, win: ListWindow): string {
  const links = TABS.map(
    (t) =>
      `<a class="tab${t.value === current ? " on" : ""}"${t.value === current ? ' aria-current="page"' : ""} data-replace href="${escape(tabHref(t.value, win.asked))}">${escape(t.label)}</a>`,
  ).join("");
  return `<nav class="tabs" aria-label="Events or community">${links}</nav>`;
}

// **A filter that narrows, never a sort that reorders** (Alex, M2.2). Tapping two
// chips shows the union of the two and leaves the order exactly as it was.
//
// "Everything" is a chip rather than a separate "clear" link, so the default state is
// visible as the thing it is: one of the choices, and the one that is on.
function chipRow(path: string, offered: Chip[], chosen: string[], win: ListWindow): string {
  if (offered.length === 0) return "";
  const all = `<a class="chip${chosen.length === 0 ? " on" : ""}" data-replace href="${escape(href(path, [], win.asked))}">${CHIP_ALL}</a>`;
  const rest = offered
    .map((c) => {
      const on = chosen.includes(c.value);
      return `<a class="chip${on ? " on" : ""}"${on ? ' aria-current="true"' : ""} data-replace href="${escape(href(path, toggle(chosen, c.value), win.asked))}">${escape(c.label)}</a>`;
    })
    .join("");
  return `<nav class="chips" aria-label="Filter by kind">${all}${rest}</nav>`;
}

// Which week this is, said plainly, so a link somebody opens a fortnight later is
// never quietly about a different week than they think.
function weekLine(win: ListWindow): string {
  if (!win.asked) return "";
  const span = `${escape(dayRange(win.start, addDays(win.end, -1)))}`;
  return `<p class="weekline">${span}</p>`;
}

function dayRange(start: string, end: string): string {
  const one = (d: string, withMonth: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      ...(withMonth ? { month: "long" } : {}),
    }).format(new Date(`${d}T00:00:00Z`));
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${one(start, !sameMonth)} – ${one(end, true)}`;
}

// The day, and how many are on. A count per day is a fact a reader uses to decide
// whether to scroll; it is not a ranking, and the days stay in date order (Q10).
function dayHeading(d: DayGroup<Crowd>): string {
  return `<h2 class="day"><span class="dayname">${escape(d.label)}</span>${
    d.sub ? `<span class="daydate">${escape(d.sub)}</span>` : ""
  }<span class="daycount">${d.rows.length}</span></h2>`;
}

// Empty, and every version of it says what to do next rather than only what is
// missing. The one case that cannot happen is "this chip has nothing": chips are
// counted from the rows on the page, so every one of them has at least three.
function emptyWeek(tab: TabValue, other: (typeof TABS)[number], otherCount: number, win: ListWindow): string {
  const mineName = tab === "community" ? "community gatherings" : "events";
  const elsewhere = otherCount
    ? ` <a data-replace href="${escape(tabHref(other.value, win.asked))}">${other.label} has ${otherCount} that week.</a>`
    : "";
  const thisWeek = win.asked ? ` <a href="${escape(tabHref(tab, null))}">Back to this week.</a>` : "";
  return `<div class="empty">No ${mineName} up for these days yet. New ones go up through the week.${elsewhere}${thisWeek}</div>`;
}

// One week at a time, forwards and back. "Later" only appears when there is something
// later to see: a link that leads to an empty page is worse than no link.
function pager(path: string, chips: string[], win: ListWindow, laterCount: number): string {
  const back = win.asked
    ? `<a class="page" href="${escape(href(path, chips, prevWindow(win)))}">← Earlier</a>`
    : "";
  const next = laterCount
    ? `<a class="page next" href="${escape(href(path, chips, win.end))}">${escape(dayRange(win.end, addDays(win.end, WINDOW_DAYS - 1)))} →</a>`
    : "";
  if (!back && !next) return "";
  return `<nav class="pager">${back}${next}</nav>`;
}

// One week back, but never behind today: the page before this week is this week.
function prevWindow(win: ListWindow): string | null {
  const earlier = addDays(win.start, -WINDOW_DAYS);
  return earlier > win.today ? earlier : null;
}

function card(g: Crowd): string {
  // Community and free gatherings are marked; a Ticketmaster listing is the default
  // and says nothing extra.
  // The chip a reader filters by, when somebody has said. It used to read "community"
  // for anything hand-entered, which was a guess from how a row arrived rather than
  // what it is — and wrong the moment a run club became "Take part". Unclassified
  // shows no chip and stays on every unfiltered list.
  const mark = g.category ? `<span class="tag">${escape(categoryLabel(g.category))}</span>` : "";
  // Never "free" unless it is free. A pay-at-the-door gathering wears its price, or
  // the words "pay at the door" when the price is not known — silence would read as
  // free to anyone scanning (Alex, after M2.2).
  // On the crowd page every gathering says what it costs, including "Ticketed". On
  // this list it would be a tag on two hundred rows and tell a reader nothing, so a
  // plain ticketed row wears none — unless it carries a note worth reading.
  const free =
    g.entry === "ticketed" && !g.entry_note ? "" : `<span class="tag">${escape(entryLine(g))}</span>`;
  return `<a class="card" href="/g/${escape(g.slug)}">
<div class="when">${escape(clock(g.starts_at, g.city_timezone))}</div>
<div class="name">${escape(g.name)}${mark}${free}</div>
<div class="where">${escape(g.venue_name)}</div>
${g.blurb ? `<div class="what">${escape(g.blurb)}</div>` : ""}
<div class="tally">${crowdLine(g)
    .split(" · ")
    .map((part) => escape(part))
    .join(DOT)}</div>
</a>`;
}

// ---------------------------------------------------------------------------
// W2 — the crowd page, before you pin
// ---------------------------------------------------------------------------

// Sharing and the calendar sit with the small links at the foot (UI pass 1). An ended
// gathering has nothing to share or add, and nothing to leave.
const W2_FOOTER = (slug: string, url: string, ended: boolean) =>
  (ended
    ? ""
    : `<p class="foot-share"><a id="share" href="${escape(url)}">Share this crowd</a>${DOT}<a href="/g/${escape(slug)}.ics">add to calendar</a></p>`) +
  `<a href="/about#safety">block</a>${DOT}` +
  `<a href="mailto:${REPORT_TO}?subject=Report%3A%20${encodeURIComponent(slug)}">report</a>${DOT}` +
  (ended ? "19+" : `leave any time${DOT}19+`);

export async function w2(request: Request, env: Env, slug: string, ctx?: ExecutionContext): Promise<Response> {
  const door = await crowd(env, slug);
  const origin = new URL(request.url).origin;

  if (door.status === "redirect") {
    return Response.redirect(`${origin}/g/${door.slug}`, 301);
  }
  if (door.status === "withdrawn") {
    // Short, neutral, no counts (spec §2 W2; V13).
    return notice("No longer on Pin'd", "This gathering is no longer on Pin'd.", 410);
  }
  if (door.status === "gone") {
    return notice("Nothing here", "There's no crowd page at this link. It may have moved.", 404);
  }

  const g = door.gathering;
  const tz = door.venue.timezone;

  // How far in this venue's picture goes, from the venue's own active spots — never
  // from this gathering's poll, so every gathering here shares one picture
  // (chooseZoom). The markers below are placed at the same zoom, because they are
  // placed from the same number.
  const zoom = chooseZoom(door.venue, door.venue.map_spots);

  // The safety net. If this venue has no picture yet, the page below falls back and
  // the image is made AFTER the response has been sent, so no visitor ever waits for
  // Mapbox and the next one gets the real map. renderVenueMap stops at the attempt
  // cap, so a venue that can never render does not loop against a paid API.
  if (!door.venue.map_image_path && !isReady(door.venue, zoom) && ctx) {
    ctx.waitUntil(ensureVenueMap(env, door.venue.id));
  }
  const url = `${origin}/g/${g.slug}`;
  const when = longWhen(g.starts_at, tz);
  // Beside the button, never inside it: "Free. Say you'd like to meet…" (UI pass 1).
  const cost = entryLine(g);
  const map = mapFigure(door, zoom);
  // **An ended gathering offers no pin** (UI pass 1, 006; #18): the same page, with what
  // happened and a way on. Pinning has closed in the database too (A26 says so); this is
  // the page not offering a door that is shut.
  const ended = Date.now() >= Date.parse(g.effective_end);

  // UI pass 1 (Alex, 30 Oct 2026; docs/design/ui-pass-1, S1): the title and one line are
  // all that show before the question. Everything else is behind one Details toggle,
  // closed by default, then "Who else is going?", the button right under it, spots
  // nearby, and the map last.
  return page(
    `${header()}
<h1>${escape(g.name)}</h1>
<p class="lede">${escape(when)}${DOT}${escape(door.venue.name)}</p>
${detailsBlock(door)}
${ended ? endedTallies(door.counts) : tallies(door.counts)}
${
  ended
    ? `<a class="cta ghost" href="/">See what&#39;s on this week</a>`
    : `${signupNotice(g)}
<a class="cta" id="cta" href="/g/${escape(g.slug)}/pin">${escape(PIN_IN)}</a>
<p class="note">${escape(pinNote(cost))}</p>`
}
${spotsNearby()}
${map.html}`,
    {
      title: `${g.name} · Pin'd`,
      // No counts in the preview: it is cached at post time and a stale number
      // would be a dishonest one (H6, W4).
      description: `${when} · ${door.venue.name}. ${ONE_LINER}`,
      canonical: url,
      image: `${origin}/og/${g.slug}.png`,
      head: `<link rel="alternate" type="text/calendar" href="/g/${escape(g.slug)}.ics">`,
      footer: withCityLine(W2_FOOTER(g.slug, url, ended), [g]),
      // One small thing the page does not need: on an iPhone the walking-directions
      // links point at Apple Maps instead of Google. With JavaScript off the links
      // still open Google Maps on every platform.
      //
      // **What used to be here, and why it is gone** (Alex, M3.1): a script relabelled
      // the button to "Open" whenever localStorage held a Supabase session, on the
      // assumption that a signed-in person has the app. Signing in once on the web
      // flipped the button on *every* crowd page at once. **A session says somebody
      // exists; it does not say they are coming to this.** The button follows what
      // they have done at this gathering: PIN_IN, or SEE_WHO once this browser has
      // pinned here (the marker both A26s write, `pinnedMarker`) — into A9.
      //
      // **Why the swap cannot simply ask the database instead.** Two rules rule it
      // out, and both are load-bearing: a fetch to supabase.co from a public page
      // breaks the own-origin rule (measured in M2.1 — 911 ms against 133 ms, paid
      // per host), and a cookie the Worker could read at render time would make the
      // page vary by cookie and lose its edge cache. So the pin writes a same-origin
      // marker and this script reads it — no network, no cookie, no cache change.
      // Written up in build-plan §8 M3.2; wired when A9 existed (Alex, M3.2 walk).
      script:
        `try{if(localStorage.getItem(${JSON.stringify(pinnedMarker(g.slug))})){var c=document.getElementById("cta");` +
        `c.textContent=${JSON.stringify(SEE_WHO)};c.href=${JSON.stringify(`/crowd/${g.slug}`)}}}catch(e){}` +
        // "Share this crowd" opens the phone's share sheet where there is one; anywhere
        // else it is the plain link to this page, which is what gets copied.
        `try{var s=document.getElementById("share");if(s&&navigator.share)s.addEventListener("click",function(e){` +
        `e.preventDefault();navigator.share({title:document.title,url:s.href}).catch(function(){})})}catch(e){}` +
        APPLE_MAPS,
    },
  );
}

// "Open in Maps" opens Apple Maps on an iPhone; with JavaScript off, or anywhere else,
// it stays the Google link, which works on every platform.
const APPLE_MAPS =
  `try{if(/iPad|iPhone|iPod/.test(navigator.platform)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)){` +
  `var m=document.querySelectorAll("a.openmap");` +
  `for(var k=0;k<m.length;k++)m[k].href="https://maps.apple.com/?ll="+encodeURIComponent(m[k].getAttribute("data-ll"))+"&q="+encodeURIComponent(m[k].getAttribute("data-q"));` +
  `}}catch(e){}`;

// "Who else is going?" rather than "See who's going", for two reasons: the page's own
// description already says "See who's going, meet them there.", so the heading would
// have restated the tagline — and on a page about one gathering, the question is the
// sentence already in the reader's head.
// The line for the reader, and the way out to whoever is putting it on.
//
// **"Tickets" for a ticket page, "Learn more" for an organiser's** (Alex): the label
// says which it is rather than pretending they are the same thing, because one of them
// is going to ask for money. W2 only — a card is already a link, and an anchor inside
// an anchor is invalid HTML.
// The way out to whoever is putting it on: one rule, for W2's Details and the app's (w2Facts).
function outLink(g: Crowd2["gathering"]): { href: string; label: string } | null {
  return g.event_url
    ? { href: g.event_url, label: g.entry === "ticketed" ? "Tickets" : "Learn more" }
    : g.signup_url
      ? { href: g.signup_url, label: "Learn more" }
      : null;
}

function blurbBlock(g: Crowd2["gathering"]): string {
  const out = outLink(g);
  if (!g.blurb && !out) return "";
  return (
    `<div class="what-it-is">` +
    (g.blurb ? `<p class="what">${escape(g.blurb)}</p>` : "") +
    (g.blurb_why ? `<p class="why">${escape(g.blurb_why)}</p>` : "") +
    (out ? `<p class="learn"><a href="${escape(out.href)}" rel="nofollow noopener" target="_blank">${out.label} →</a></p>` : "") +
    `</div>`
  );
}

// The two counters, stacked, each with its icon (UI pass 1, rule 5: every crowd page
// state). The words come from COUNTERS in packages/shared, which A9 draws too; nobody
// pinned at all is the one invitation instead of two zeros (M2.3).
function tallies(c: Counts): string {
  const mix = mixLine(c);
  const crews = crewLine(c);
  const next = countNext(c.open_to_meeting);
  if (c.pinned === 0) {
    return `<div class="asks-block"><p class="asks">${escape(WHO_ELSE)}</p>
<p class="count-line">${escape(COUNTERS.nobody)}</p></div>`;
  }
  return `<div class="asks-block"><p class="asks">${escape(WHO_ELSE)}</p>
<p class="counter">${icon("person", 22)}${escape(COUNTERS.going(c.pinned))}</p>
<p class="counter">${icon("handshake", 22)}${escape(COUNTERS.open(c.open_to_meeting))}</p>
${next ? `<p class="mix">${escape(next)}</p>` : ""}
${mix ? `<p class="mix">${escape(mix)}</p>` : ""}
${crews ? `<p class="mix">${escape(crews)}</p>` : ""}</div>`;
}

// An ended gathering (006): what happened, honestly, with the count it reached (H6).
function endedTallies(c: Counts): string {
  return `<div class="asks-block"><p class="asks">${escape(WHO_ELSE)}</p>
<p class="count-line">This gathering has finished.</p>
<p class="mix">${escape(COUNTERS.pinnedIn(c.pinned))}</p></div>`;
}

// Everything but the title and its one line, behind one toggle, closed by default
// (UI pass 1, 005). A <details>, so it opens with JavaScript off and costs no script.
// The house rules live in here, which is how they are "one collapsed row" on W2.
function detailsBlock(door: Crowd2): string {
  const v = door.venue;
  return `<details class="more"><summary><span class="closed-label">${CROWD_PAGE_COPY.details}</span><span class="open-label">${CROWD_PAGE_COPY.hideDetails}</span>${icon("chevronDown", 16)}</summary>
<div class="more-body">
${v.address ? `<p class="addr">${escape(v.address)}</p>` : ""}
${blurbBlock(door.gathering)}
<div class="rules-block"><p class="kicker">House rules</p>
<ol class="rules-plain">${HOUSE_RULES.map((r) => `<li>${escape(r)}</li>`).join("")}</ol></div>
<p class="how">${escape(THRESHOLD_EXPLANATION)}</p>
</div></details>`;
}

// **Spots nearby** replaces "Where crews meet" (UI pass 1, rule 3: we don't engineer
// meeting places). A quiet empty state until there is something to list here.
function spotsNearby(): string {
  return `<section class="nearby"><p class="kicker">${CROWD_PAGE_COPY.spotsNearby}</p><p class="nearby-empty">${CROWD_PAGE_COPY.nothingNearby}</p></section>`;
}

// The venue and its meeting spots, never people (H1), and never the viewer (H4).
//
// Three steps down, decided before the first byte is sent, so there is never a broken
// image and never a layout jump:
//   1. the real map — an uploaded override, or the picture fetched once from Mapbox;
//   2. the schematic, if the venue and at least one spot have coordinates;
//   3. nothing at all, and the spots list below reads perfectly well on its own.
//
// The image carries explicit width and height so its box is reserved before the bytes
// arrive. Everything with meaning sits on top of it in HTML: the numbered markers, the
// north arrow, the venue's own name. None of it is baked into the picture, so
// approving a spot later changes the page without re-rendering anything.
//
// **What the markers say, and what they no longer say** (M2.3). Each spot used to
// carry its name, its walking minutes and a "Directions" link in a box beside its dot,
// and the box WAS the whole interaction: tapping it left the page for Google Maps.
// Two things were wrong with that, one measured and one a decision:
//
//   - **The boxes overlap.** Of the six venues with more than one spot, three have
//     spots that land within one label's width of each other, and Snakes & Lattes
//     College has three inside a box 23% of the picture wide. Adaptive zoom fixes the
//     cause and is not sufficient on its own: at zoom 17 its closest pair is still
//     14% apart against a label 19.5% wide. Three boxes fill a phone-width picture
//     whatever the zoom.
//   - **A spot should be a card, with the maps link inside it** (Alex; decisions Part
//     5, "A spot is a card, not a maps link"). A crew choosing between three spots has
//     a name and a walking time to choose on, which is not enough. The card is where
//     what-it-is-like will live when the manual pass writes it (M5.2); this milestone
//     builds the shape and puts today's facts in it.
//
// So the map answers "how far, and which way" with numbered dots, and the numbered
// cards under it answer "what, and when". Tapping a dot is a link to its own card —
// an anchor, no JavaScript — and the directions link lives in the card.
type MapKind = "real" | "schematic" | "none";

// Above the button, never inside it. Pinning in means "I am going" — a statement
// about the person, not a claim about a place being available — so somebody who has
// registered with the organiser is telling the truth. What would have been dishonest
// is letting them find out afterwards (Alex, before the wider community pass).
function signupNotice(g: Crowd2["gathering"]): string {
  if (!g.signup_required && !g.signup_url) return "";
  const where = g.signup_url
    ? `<a href="${escape(g.signup_url)}" rel="noreferrer noopener" target="_blank">Register with the organiser first</a>`
    : `Register with the organiser first`;
  return `<p class="signup">${where}, then pin in here so you can see who else is going.</p>`;
}

function mapFigure(door: Crowd2, zoom: number): { html: string; kind: MapKind } {
  const v = door.venue;
  // An uploaded override is somebody's own picture at an unknown scale, so no marker
  // is placed on it: our coordinates mean nothing over it, and a dot 200 m out is
  // worse than no dot. Its spots are in the cards below like everyone else's. (No
  // public venue has one today — the only upload on staging is a seed row.)
  if (v.map_image_path) {
    return { html: `<figure>${plainFrame(uploadUrl(v.id, v.map_image_path), v)}${caption(v, false)}</figure>`, kind: "none" };
  }
  // The venue alone (UI pass 1, rule 3): no numbered meeting spots on it any more, and
  // no schematic, which existed only to draw them.
  const real = readyMapUrl(v, zoom);
  if (real) return { html: `<figure>${venueFrame(real, v)}${caption(v, true)}</figure>`, kind: "real" };
  return { html: "", kind: "none" };
}

function readyMapUrl(v: Crowd2["venue"], zoom: number): string | null {
  const key = mapKey(v, zoom);
  return key && isReady(v, zoom) ? mapUrl(v.id, key) : null;
}

// The caption under every version of the figure: what it shows, a way into a real map,
// and Mapbox's attribution where the picture is Mapbox's.
//
// **"Open in Maps" is the cheapest interactivity there is** (Alex, after the M2.3
// walk). The phone's own map app pans, zooms, searches and routes; it costs this page
// one link, against roughly 200 KB of JavaScript for a map library on a page that is
// 9 KB. It goes beside the caption rather than near the button: the button is the
// commitment, this is a convenience.
function caption(v: Crowd2["venue"], attribution: boolean): string {
  const open = venueDirections(v);
  const link = open
    ? `<a class="openmap" href="${escape(open)}" target="_blank" rel="noopener" data-ll="${escape(
        `${v.latitude},${v.longitude}`,
      )}" data-q="${escape(v.name)}">Open in Maps</a>`
    : "";
  const mapbox = attribution
    ? `<br><span class="credit">© <a href="https://www.mapbox.com/about/maps/" rel="nofollow noopener">Mapbox</a> ` +
      `© <a href="https://www.openstreetmap.org/copyright" rel="nofollow noopener">OpenStreetMap</a> contributors</span>`
    : "";
  return `<figcaption>${link}${mapbox}</figcaption>`;
}

// Where each spot sits on the picture. A spot outside the frame gets no marker and is
// told so in the list, rather than quietly lacking one.
export function placedSpots(door: Crowd2, zoom: number): { spot: Spot; at: Placed | null }[] {
  const v = door.venue;
  return door.spots.map((spot) => ({
    spot,
    at:
      v.latitude !== null && v.longitude !== null && spot.latitude !== null && spot.longitude !== null
        ? place(
            { latitude: v.latitude, longitude: v.longitude },
            { latitude: spot.latitude, longitude: spot.longitude },
            zoom,
          )
        : null,
  }));
}

// The number a spot wears. **Only the spots actually on the picture are numbered, and
// they are numbered consecutively**, so the map never shows 1 and 3 and leaves a
// reader hunting for a 2 that is a two-kilometre walk away (seen on Sneaky Dee's page
// the first time this deployed). A spot off the frame keeps its own card and its own
// anchor, and says where it is instead.
function numbered(door: Crowd2, zoom: number): { spot: Spot; at: Placed | null; id: string; n: number | null }[] {
  let n = 0;
  return placedSpots(door, zoom).map(({ spot, at }, i) => ({
    spot,
    at,
    id: `spot-${i + 1}`,
    n: at?.onMap ? ++n : null,
  }));
}

// The rendered picture with the venue's dot and name on it, and nothing else.
function venueFrame(src: string, v: Crowd2["venue"]): string {
  return `<div class="mapbox">
<img src="${escape(src)}" width="768" height="480" alt="Map of ${escape(v.name)}. No people are shown." decoding="async">
<span class="venue-pin" aria-hidden="true"></span>
<span class="venue-name">${escape(v.name)}</span>
<span class="north" aria-hidden="true">N</span>
</div>`;
}

// The same picture with nothing placed over it but the venue's own name: for an
// uploaded override, whose scale we do not know.
function plainFrame(src: string, v: Crowd2["venue"]): string {
  return `<div class="mapbox">
<img src="${escape(src)}" width="768" height="480" alt="Map of ${escape(v.name)}. No people are shown." decoding="async">
<span class="north" aria-hidden="true">N</span>
</div>`;
}

function walkMetres(v: Crowd2["venue"], spot: Spot): number | null {
  if (v.latitude === null || v.longitude === null || spot.latitude === null || spot.longitude === null) return null;
  const midLat = ((v.latitude + spot.latitude) / 2) * (Math.PI / 180);
  const dx = (spot.longitude - v.longitude) * 111_320 * Math.cos(midLat);
  const dy = (spot.latitude - v.latitude) * 110_574;
  return walkMinutes(Math.hypot(dx, dy));
}

// Walking directions, in the phone's own maps app. Google's universal URL works on
// every platform, including desktop; the small script on the page rewrites it to
// Apple Maps on iOS. With JavaScript off, everyone still gets a working link.
//
// This does not touch H4: the location permission is asked for by the maps app, by
// the person, after they have left our page, and we never see the answer.
export function directions(spot: Spot): string {
  const to = `${spot.latitude},${spot.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(to)}&travelmode=walking`;
}

// ---------------------------------------------------------------------------
// W3 — the share card, now a venue card (UI pass 1, 009): the gathering, its date and
// venue, the address, the map and a way into the phone's own maps. No meeting spot or
// time (rule 3), no names, no join link. A group's older `?at=&t=` link still lands
// here; it is simply not read.
// ---------------------------------------------------------------------------

export async function w3(request: Request, env: Env, slug: string): Promise<Response> {
  const door = await crowd(env, slug);
  const origin = new URL(request.url).origin;

  if (door.status === "redirect") return Response.redirect(`${origin}/g/${door.slug}/spot`, 301);
  if (door.status === "withdrawn") return notice("No longer on Pin'd", "This gathering is no longer on Pin'd.", 410);
  if (door.status === "gone") return notice("Nothing here", "There's no crowd page at this link. It may have moved.", 404);

  const v = door.venue;
  const tz = v.timezone;
  const zoom = chooseZoom(v, v.map_spots);
  const real = v.map_image_path ? uploadUrl(v.id, v.map_image_path) : readyMapUrl(v, zoom);
  const open = venueDirections(v);

  return page(
    `${header()}
<h1>${escape(door.gathering.name)}</h1>
<p class="lede">${escape(longWhen(door.gathering.starts_at, tz))}${DOT}${escape(v.name)}</p>
${v.address ? `<p class="addr">${escape(v.address)}</p>` : ""}
${real ? `<figure>${venueFrame(real, v)}</figure>` : ""}
${open ? `<a class="cta openmap" href="${escape(open)}" target="_blank" rel="noopener" data-ll="${escape(`${v.latitude},${v.longitude}`)}" data-q="${escape(v.name)}">Open in Maps</a>` : ""}`,
    {
      title: `${door.gathering.name} · ${v.name} · Pin'd`,
      canonical: `${origin}/g/${door.gathering.slug}/spot`,
      footer: `19+${DOT}leave any time`,
      script: APPLE_MAPS,
    },
  );
}

// ---------------------------------------------------------------------------
// The .ics — "add to calendar" (W4)
// ---------------------------------------------------------------------------

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// RFC 5545: escape the separators, and fold nothing (our lines stay short enough).
const ical = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export async function ics(request: Request, env: Env, slug: string): Promise<Response> {
  const door = await crowd(env, slug);
  if (door.status !== "ok") return new Response("Not found", { status: 404 });

  const origin = new URL(request.url).origin;
  const g = door.gathering;
  const where = [door.venue.name, door.venue.address].filter(Boolean).join(", ");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pin'd//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${g.slug}@pind.social`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(g.starts_at)}`,
    `DTEND:${stamp(g.ends_at ?? g.effective_end)}`,
    `SUMMARY:${ical(g.name)}`,
    `LOCATION:${ical(where)}`,
    `DESCRIPTION:${ical(ONE_LINER)}`,
    `URL:${origin}/g/${g.slug}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return new Response(`${lines.join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${g.slug}.ics"`,
      "cache-control": "public, max-age=0, s-maxage=300",
    },
  });
}

// ---------------------------------------------------------------------------
// About — the page W1's and W2's footers point at
// ---------------------------------------------------------------------------

export function about(): Response {
  return page(
    `${header()}
<h1>About Pin&#39;d</h1>
<p>You&#39;re already going. So are other people. Pin&#39;d is how you find each other beforehand and walk in together, instead of arriving alone because nobody knew who else was coming.</p>
<p>Pin in to something you have a ticket for, or are just going to. If you fancy company, say so. That part is optional, and you can change your mind at any point. Once two people have said so, a room opens for everyone there who would like to meet, so you can say hi first. From there you can start or join a squad, a small group going together, or meet one person 1-on-1.</p>
<p>No messaging strangers, no swiping, no feed. Just the people who are going to the same thing as you.</p>

${houseRulesRow()}

<h2 id="safety">Safety</h2>
<p>Nobody sees your name or your photo until you have both pinned in and said you&#39;d like to meet at the same gathering. Until then there is nothing to browse, which is the point.</p>
<p>Pin&#39;d is never at the event. The only conversations are about it: its room, for everyone there who would like to meet, and the chat inside a squad or a 1-on-1.</p>
<p>${escape(SAFETY_TODAY.app)} Some reasons hide the person the moment they are used.</p>
<p>Pin&#39;d never asks where you are. The only coordinates we hold belong to venues and public places near them.</p>
<p>19+.</p>

<h2>Say hello</h2>
<p>Know a gathering that belongs here? <a href="mailto:${SUGGEST_TO}">${SUGGEST_TO}</a>.${DOT}Anything about safety goes to <a href="mailto:${REPORT_TO}">${REPORT_TO}</a>, and a person reads it.</p>`,
    { title: "About · Pin'd", description: ONE_LINER, footer: `<a href="/">this week&#39;s crowds</a>${DOT}19+` },
  );
}

// ---------------------------------------------------------------------------
// robots.txt and the favicon
// ---------------------------------------------------------------------------

// Nothing is indexed until the privacy policy lands (M4.1; decisions Part 5).
export function robots(): Response {
  return new Response("User-agent: *\nDisallow: /\n", {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

export function favicon(): Response {
  return new Response(faviconSvg(), {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
  });
}

export { walkMinutes };

// ---------------------------------------------------------------------------
// W2's facts as data, for the app's A8 (M3.2)
//
// A8 is "the same anatomy as W2 so a shared link feels continuous" (spec), and W2 is
// the page Alex judges everything else against. So the app does not rebuild W2's
// decisions — which map (the uploaded one, the rendered one, none), which zoom, where
// each numbered marker sits, which spots are off the frame, the walk, the cost line —
// it asks for them, built here by W2's own functions. One copy of each rule.
// Public facts only (the door as a visitor sees it); nothing about anyone.
// ---------------------------------------------------------------------------
export function w2Facts(door: Crowd2, origin: string) {
  const g = door.gathering;
  const v = door.venue;
  const tz = v.timezone;
  const zoom = chooseZoom(v, v.map_spots);
  const real = v.map_image_path ? null : readyMapUrl(v, zoom);
  const placed = numbered(door, zoom);
  return {
    name: g.name,
    when: longWhen(g.starts_at, tz),
    venue: v.name,
    address: v.address,
    blurb: g.blurb,
    why: g.blurb_why,
    cost: entryLine(g) || null,
    // UI pass 1: the line under the Pin in button, and the Details link, as W2 draws them.
    note: pinNote(entryLine(g)),
    link: outLink(g),
    signupRequired: g.signup_required,
    map: real
      ? {
          src: `${origin}${real}`,
          width: 768,
          height: 480,
          openInMaps: venueDirections(v),
          markers: placed.filter((p) => p.n !== null).map(({ at, n }) => ({ n: n!, left: at!.left, top: at!.top })),
        }
      : null,
    spots: placed.map(({ spot, at, n }) => {
      const walk = spot.walk_minutes ?? walkMetres(v, spot);
      return {
        n: real ? n : null,
        name: spot.name,
        description: spot.description,
        meet: clock(spot.meet_at, tz),
        walk,
        offMap: !!real && !at?.onMap,
        directions: spot.latitude !== null ? directions(spot) : null,
      };
    }),
  };
}

export async function w2FactsJson(request: Request, env: Env, slug: string): Promise<Response> {
  const door = await crowd(env, slug);
  if (door.status !== "ok") return new Response(JSON.stringify({ status: door.status }), { status: 404, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify(w2Facts(door, new URL(request.url).origin)), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=0, s-maxage=60" },
  });
}
