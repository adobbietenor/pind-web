// W1–W3 and the small public routes around them (spec §2).
//
// Everything here reads through src/public/data.ts, which reads through the anon key
// and the two public_* database functions. No page filters anything itself (H11).

import { categoryLabel, CREWS_MEET, entryLine, HOUSE_RULES, ONE_LINER, PIN_IN, THRESHOLD } from "@pind/shared";
import type { Env } from "../env";
import { DEFAULT_TZ, fromLocalInput, localDate } from "../admin/time";
import { markSvg } from "./brand";
import { crowd, crowds, type Counts, type Crowd, type Crowd2, type Spot } from "./data";
import { DOT, escape, header, notice, page } from "./layout";
import {
  addDays,
  applyChips,
  chipsFor,
  dayGroups,
  href,
  parseChips,
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
import { venueMap, walkMinutes } from "./map";
import { ensureVenueMap } from "./mapserve";
import { chooseZoom, isReady, mapKey, mapUrl, place, uploadUrl, type Placed } from "./venuemap";

// Where "suggest a gathering" and "report" go. Nothing is stored (spec §2 W1):
// it is a mailto and no more. One place to change when Alex picks the addresses.
const SUGGEST_TO = "crowds@pind.social";
const REPORT_TO = "safety@pind.social";

// ---------------------------------------------------------------------------
// Time, in the venue's city
// ---------------------------------------------------------------------------

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...opts }).format(new Date(iso));
}

const clock = (iso: string, tz: string) => fmt(iso, tz, { hour: "numeric", minute: "2-digit" });

// The date in this product's own voice — "Saturday 26 September", not en-CA's
// "Saturday, September 26" — with the time still on a 12-hour clock, which is what
// Toronto reads. Two locales because each is right for its half.
const dateLong = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(
    new Date(iso),
  );

const longWhen = (iso: string, tz: string) => `${dateLong(iso, tz)}, ${clock(iso, tz)}`;

// ---------------------------------------------------------------------------
// Counts, said honestly (H6). Zero is a number and it is shown.
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function crewLine(c: { crews_open: boolean }): string {
  return c.crews_open ? "crews forming" : `crews open at ${THRESHOLD}`;
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
  const now = new Date();
  const win = windowFor(now, DEFAULT_TZ, url.searchParams.get("from"));

  // Local midnight to local midnight, in the city's own zone: a Friday night show at
  // 11pm belongs to Friday, and a week boundary in Toronto is not one in UTC.
  const from = new Date(fromLocalInput(`${win.start}T00:00`, DEFAULT_TZ)!);
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
    `${header()}
<h1>${escape(tab === "community" ? "Community this week" : "This week’s crowds")}</h1>
<p class="lede">${escape(ONE_LINER)}</p>
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
      footer: W1_FOOTER,
      script: REPLACE_SCRIPT,
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
  const all = `<a class="chip${chosen.length === 0 ? " on" : ""}" data-replace href="${escape(href(path, [], win.asked))}">Everything</a>`;
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
  return `<div class="empty">No ${mineName} up for these days yet — new ones go up through the week.${elsewhere}${thisWeek}</div>`;
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
<div class="tally">${escape(plural(g.pinned, "pinned", "pinned"))}${DOT}${escape(crewLine(g))}</div>
</a>`;
}

// ---------------------------------------------------------------------------
// W2 — the crowd page, before you pin
// ---------------------------------------------------------------------------

const W2_FOOTER = (slug: string) =>
  `<a href="/about#safety">block</a>${DOT}` +
  `<a href="mailto:${REPORT_TO}?subject=Report%3A%20${encodeURIComponent(slug)}">report</a>${DOT}` +
  `leave any time${DOT}19+`;

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
    return notice("Nothing here", "There's no crowd page at this link — it may have moved.", 404);
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
  const button = PIN_IN;
  // Beside the button, never inside it.
  const cost = entryLine(g);
  const map = mapFigure(door, zoom);

  return page(
    `${header()}
<h1>${escape(g.name)}</h1>
<p class="lede">${escape(when)}${DOT}${escape(door.venue.name)}</p>
${door.venue.address ? `<p class="lede" style="margin-bottom:0">${escape(door.venue.address)}</p>` : ""}

${tallies(door.counts)}
${map.html}

${signupNotice(g)}
<a class="cta" id="cta" href="/g/${escape(g.slug)}/pin">${escape(button)}</a>
${cost ? `<p class="cost">${escape(cost)}</p>` : ""}
<p class="note">Pin in and say you&#39;d like to meet, and you&#39;ll see everyone else who did.</p>

<h2>House rules</h2>
<ol class="rules">${HOUSE_RULES.map((r) => `<li>${escape(r)}</li>`).join("")}</ol>
<p class="crews-meet">${escape(CREWS_MEET)}</p>

${spotList(door, tz, map.kind, zoom)}

<h2>Pass it on</h2>
<p class="quiet" style="font-size:.9rem">
<a href="${escape(url)}">${escape(url)}</a>${DOT}<a href="/g/${escape(g.slug)}.ics">add to calendar</a>
${g.event_url ? `${DOT}<a href="${escape(g.event_url)}" rel="nofollow noopener">tickets</a>` : ""}
</p>`,
    {
      title: `${g.name} · Pin'd`,
      // No counts in the preview: it is cached at post time and a stale number
      // would be a dishonest one (H6, W4).
      description: `${when} · ${door.venue.name}. ${ONE_LINER}`,
      canonical: url,
      image: `${origin}/og/${g.slug}.png`,
      head: `<link rel="alternate" type="text/calendar" href="/g/${escape(g.slug)}.ics">`,
      footer: W2_FOOTER(g.slug),
      // If this browser already has a session, the button says Open instead. The
      // page is complete without this; JavaScript only relabels one element.
      // Two small things, neither of which the page needs. If this browser already
      // has a session the button says Open; and on an iPhone the walking-directions
      // links point at Apple Maps instead of Google. With JavaScript off, the button
      // still works and the links still open Google Maps on every platform.
      script:
        // A map dot opens its card without leaving a history entry behind. Tapping
        // three dots used to leave three, so "back" appeared to do nothing — it was
        // undoing a hash change on the same page. With JavaScript off the anchor still
        // works and :target still lights the card; it simply also pushes an entry.
        `try{var p=document.querySelectorAll("a.pin");` +
        `for(var i=0;i<p.length;i++)p[i].addEventListener("click",function(e){` +
        `if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;` +
        `var t=document.getElementById(this.getAttribute("href").slice(1));if(!t)return;` +
        `e.preventDefault();var l=document.querySelector(".spot.lit");if(l)l.className="spot";` +
        `t.className="spot lit";t.scrollIntoView({behavior:"smooth",block:"center"})});}catch(e){}` +
        `try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);` +
        `if(k&&k.indexOf("sb-")===0&&k.indexOf("-auth-token")>0){` +
        `document.getElementById("cta").textContent="Open";break}}}catch(e){}` +
        `try{if(/iPad|iPhone|iPod/.test(navigator.platform)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)){` +
        `var a=document.querySelectorAll('a[href*="google.com/maps/dir"]');` +
        `for(var j=0;j<a.length;j++){var d=new URL(a[j].href).searchParams.get("destination");` +
        `if(d)a[j].href="https://maps.apple.com/?daddr="+encodeURIComponent(d)+"&dirflg=w"}}}catch(e){}`,
    },
  );
}

function tallies(c: Counts): string {
  const mix = mixLine(c);
  return `<div class="tallies">
<div class="tally-box"><b>${c.pinned}</b><span>pinned</span></div>
<div class="tally-box"><b>${c.open_to_meeting}</b><span>open to meeting</span></div>
</div>
<p class="mix">${mix ? escape(mix) : escape(crewLine(c))}</p>`;
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
  return `<p class="signup">${where} — then pin in here so you can see who else is going.</p>`;
}

function mapFigure(door: Crowd2, zoom: number): { html: string; kind: MapKind } {
  const v = door.venue;
  // An uploaded override is somebody's own picture at an unknown scale, so no marker
  // is placed on it: our coordinates mean nothing over it, and a dot 200 m out is
  // worse than no dot. Its spots are in the cards below like everyone else's. (No
  // public venue has one today — the only upload on staging is a seed row.)
  if (v.map_image_path) {
    return { html: `<figure>${plainFrame(uploadUrl(v.id, v.map_image_path), v)}${credit()}</figure>`, kind: "none" };
  }
  const real = readyMapUrl(v, zoom);
  if (real) return { html: `<figure>${frame(real, door, zoom)}${credit()}</figure>`, kind: "real" };

  const svg = venueMap(v, door.spots);
  if (svg) {
    // The schematic fits itself to the spots, so everything it has is on it — the
    // "not shown on the map" line below must not appear under this one.
    return {
      html: `<figure>${svg}<figcaption>The venue, and the spots crews meet at — never where anyone is.</figcaption></figure>`,
      kind: "schematic",
    };
  }
  return { html: "", kind: "none" };
}

function readyMapUrl(v: Crowd2["venue"], zoom: number): string | null {
  const key = mapKey(v, zoom);
  return key && isReady(v, zoom) ? mapUrl(v.id, key) : null;
}

const credit = () =>
  `<figcaption>The venue, and the spots crews meet at — never where anyone is.<br>` +
  `<span class="credit">© <a href="https://www.mapbox.com/about/maps/" rel="nofollow noopener">Mapbox</a> ` +
  `© <a href="https://www.openstreetmap.org/copyright" rel="nofollow noopener">OpenStreetMap</a> contributors</span></figcaption>`;

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

function frame(src: string, door: Crowd2, zoom: number): string {
  const v = door.venue;
  const markers = numbered(door, zoom)
    .filter((p) => p.n !== null)
    .map(({ spot, at, id, n }) => {
      const walk = spot.walk_minutes ?? walkMetres(v, spot);
      // The dot is a link to its own card, so tapping the map explains the place
      // rather than leaving the site. It is a plain anchor: no JavaScript, and it
      // works with the keyboard.
      return `<a class="pin" style="left:${at!.left.toFixed(2)}%;top:${at!.top.toFixed(2)}%" href="#${id}" aria-label="${escape(
        `${spot.name}${walk ? `, ${walk} ${walk === 1 ? "minute" : "minutes"}' walk` : ""} — see the details`,
      )}"><span class="num">${n}</span></a>`;
    })
    .join("");

  return `<div class="mapbox">
<img src="${escape(src)}" width="768" height="480" alt="Map of ${escape(v.name)} and the numbered spots crews meet at. No people are shown." decoding="async">
<span class="venue-pin" aria-hidden="true"></span>
<span class="venue-name">${escape(v.name)}</span>
<span class="north" aria-hidden="true">N</span>
${markers}
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

// One card per spot, numbered to match the map, with the walking directions link
// inside it. The card is the interaction; the dot on the map is a way into it.
//
// What a card holds today is what we honestly know: the name, what it is (where
// somebody has written that), how far the walk is, when the crew meets there, and the
// link out. **The rest of the card — what the place is like, whether six can get a
// table without booking, how loud it is — is the manual spot pass, and it is not
// invented here** (decisions Part 5, "Spot content starts as a manual pass"). An
// empty field says nothing rather than saying something we guessed.
function spotList(door: Crowd2, tz: string, kind: MapKind, zoom: number): string {
  const placed = numbered(door, zoom);
  if (placed.length === 0) return "";
  // Only the real map has a fixed frame that a spot can fall outside of. The
  // schematic fits itself to whatever it is given, and when there is no map at all
  // there is nothing for a spot to be missing from.
  const framed = kind === "real";

  const items = placed
    .map(({ spot, at, id, n }) => {
      const walk = spot.walk_minutes ?? walkMetres(door.venue, spot);
      const bits = [`meet ${clock(spot.meet_at, tz)}`];
      if (walk) bits.push(`${walk} min walk`);
      // Not on the map, and said out loud: someone comparing the cards to the picture
      // should never have to wonder whether the marker is missing or the spot is.
      if (framed && !at?.onMap) bits.push("a bit further out, so not on the map above");
      // The badge appears only where the map is showing that number.
      const badge = framed && n !== null ? `<span class="num">${n}</span>` : "";
      const link =
        spot.latitude !== null
          ? `<a class="dirs" href="${escape(directions(spot))}" target="_blank" rel="noopener">Walking directions</a>`
          : "";
      return `<li id="${id}" class="spot">
<div class="spot-top">${badge}<b>${escape(spot.name)}</b></div>
${spot.description ? `<p class="spot-what">${escape(spot.description)}</p>` : ""}
<div class="meta">${escape(bits.join(" · "))}</div>
${link}</li>`;
    })
    .join("");
  return `<h2>Where crews meet</h2><ul class="spots">${items}</ul>`;
}

// ---------------------------------------------------------------------------
// W3 — the share card: gathering, spot, time. No names, no join link.
// ---------------------------------------------------------------------------

export async function w3(request: Request, env: Env, slug: string): Promise<Response> {
  const door = await crowd(env, slug);
  const origin = new URL(request.url).origin;

  if (door.status === "redirect") return Response.redirect(`${origin}/g/${door.slug}/spot`, 301);
  if (door.status === "withdrawn") return notice("No longer on Pin'd", "This gathering is no longer on Pin'd.", 410);
  if (door.status === "gone") return notice("Nothing here", "There's no crowd page at this link — it may have moved.", 404);

  const tz = door.venue.timezone;
  const spots = door.spots
    .map(
      (s) =>
        `<li><b>${escape(s.name)}</b><div class="meta">${escape(clock(s.meet_at, tz))}</div></li>`,
    )
    .join("");

  return page(
    `${header()}
<h1>${escape(door.gathering.name)}</h1>
<p class="lede">${escape(longWhen(door.gathering.starts_at, tz))}${DOT}${escape(door.venue.name)}</p>
${spots ? `<h2>Where crews meet</h2><ul class="spots">${spots}</ul>` : `<p class="quiet">Spots for this one aren&#39;t set yet.</p>`}`,
    {
      title: `${door.gathering.name} · meeting spots · Pin'd`,
      canonical: `${origin}/g/${door.gathering.slug}/spot`,
      footer: `19+${DOT}leave any time`,
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
<p>Pin in to something you have a ticket for, or are just going to. If you fancy company, say so — that part is optional, and you can change your mind at any point. Once ${THRESHOLD} people have said so, crews open: small groups of three to eight who pick a spot nearby, meet there beforehand, and go in together.</p>
<p>No messaging strangers, no swiping, no feed. Just the people who are going to the same thing as you.</p>

<h2>House rules</h2>
<ol class="rules">${HOUSE_RULES.map((r) => `<li>${escape(r)}</li>`).join("")}</ol>
<p class="crews-meet">${escape(CREWS_MEET)}</p>

<h2 id="safety">Safety</h2>
<p>Nobody sees your name or your photo until you have both pinned in and said you&#39;d like to meet at the same gathering. Until then there is nothing to browse — which is the point.</p>
<p>Crews meet at named public places, before the event, and Pin&#39;d is never there. There are no direct messages: the only conversation is inside a crew, once one has formed.</p>
<p>Blocking is mutual and silent — the other person is never told, and neither of you sees the other again. Block and report sit one tap from any person, crew or message in the app, and some reasons hide the person the moment they are used.</p>
<p>Pin&#39;d never asks where you are. The only coordinates we hold belong to venues and the spots crews meet at.</p>
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
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="#0B0A0D"/>` +
    `<g transform="translate(12,12)" color="#FFFFFF">${markSvg(40)}</g>` +
    `</svg>`;
  return new Response(svg, {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
  });
}

export { walkMinutes };
