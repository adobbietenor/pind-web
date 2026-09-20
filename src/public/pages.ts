// W1–W3 and the small public routes around them (spec §2).
//
// Everything here reads through src/public/data.ts, which reads through the anon key
// and the two public_* database functions. No page filters anything itself (H11).

import { HOUSE_RULES, ONE_LINER, PIN_IN, PIN_IN_FREE, THRESHOLD } from "@pind/shared";
import type { Env } from "../env";
import { localDate } from "../admin/time";
import { markSvg } from "./brand";
import { crowd, crowds, type Counts, type Crowd, type Crowd2, type Spot } from "./data";
import { DOT, escape, header, notice, page } from "./layout";
import { venueMap, walkMinutes } from "./map";

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

const dayHeading = (iso: string, tz: string) =>
  fmt(iso, tz, { weekday: "long", day: "numeric", month: "long" });

const clock = (iso: string, tz: string) => fmt(iso, tz, { hour: "numeric", minute: "2-digit" });

const longWhen = (iso: string, tz: string) =>
  fmt(iso, tz, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });

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

const W1_FOOTER =
  `<a href="mailto:${SUGGEST_TO}?subject=A%20gathering%20for%20Pin%27d">suggest a gathering</a>` +
  `${DOT}<a href="/about">about</a>${DOT}19+`;

export async function w1(request: Request, env: Env): Promise<Response> {
  const now = new Date();
  // From the start of today in Toronto through the next four weeks: "this week"
  // with enough after it that the page is never empty the moment a week turns.
  const from = new Date(now.getTime() - 12 * 3600_000);
  const to = new Date(now.getTime() + 28 * 86_400_000);
  const list = await crowds(env, from, to);

  const origin = new URL(request.url).origin;
  const body = list.length === 0 ? emptyWeek() : byDay(list);

  return page(
    `${header()}
<h1>This week&#39;s crowds</h1>
<p class="lede">${escape(ONE_LINER)}</p>
${body}`,
    {
      title: "This week's crowds · Pin'd",
      description: ONE_LINER,
      canonical: `${origin}/`,
      footer: W1_FOOTER,
    },
  );
}

function emptyWeek(): string {
  return `<div class="empty" style="margin-top:22px">No crowds are up yet. Check back — new ones go up through the week.</div>`;
}

// Grouped by day, ordered by date, never by size (Q10). Small counts are shown,
// never hidden, including zero (H6).
function byDay(list: Crowd[]): string {
  const days = new Map<string, Crowd[]>();
  for (const g of list) {
    const key = localDate(g.starts_at, g.city_timezone);
    const bucket = days.get(key);
    if (bucket) bucket.push(g);
    else days.set(key, [g]);
  }

  const out: string[] = [];
  for (const [, group] of days) {
    const first = group[0]!;
    out.push(`<h2>${escape(dayHeading(first.starts_at, first.city_timezone))}</h2>`);
    for (const g of group) out.push(card(g));
  }
  return out.join("");
}

function card(g: Crowd): string {
  // Community and free gatherings are marked; a Ticketmaster listing is the default
  // and says nothing extra.
  const mark = g.source === "manual" || g.source === "ai" ? `<span class="tag">community</span>` : "";
  const free = g.is_free ? `<span class="tag">free</span>` : "";
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

export async function w2(request: Request, env: Env, slug: string): Promise<Response> {
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
    return notice("Not found", "There is no crowd page at this link.", 404);
  }

  const g = door.gathering;
  const tz = door.venue.timezone;
  const url = `${origin}/g/${g.slug}`;
  const when = longWhen(g.starts_at, tz);
  const button = g.is_free ? PIN_IN_FREE : PIN_IN;

  return page(
    `${header()}
<h1>${escape(g.name)}</h1>
<p class="lede">${escape(when)}${DOT}${escape(door.venue.name)}</p>
${door.venue.address ? `<p class="lede" style="margin-bottom:0">${escape(door.venue.address)}</p>` : ""}

${tallies(door.counts)}
${mapFigure(door)}

<a class="cta" id="cta" href="/g/${escape(g.slug)}/pin">${escape(button)}</a>
<p class="note">Names and photos unlock after you pin in and opt to meet.</p>

<h2>House rules</h2>
<ol class="rules">${HOUSE_RULES.map((r) => `<li>${escape(r)}</li>`).join("")}</ol>

${spotList(door.spots, tz)}

<h2>Share</h2>
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
      script:
        `try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);` +
        `if(k&&k.indexOf("sb-")===0&&k.indexOf("-auth-token")>0){` +
        `document.getElementById("cta").textContent="Open";break}}}catch(e){}`,
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

// The venue and its meeting spots, never people (H1). An uploaded image overrides
// the generated map; a venue with no coordinates gets no map and still reads fine.
function mapFigure(door: Crowd2): string {
  const uploaded = door.venue.map_image_path;
  if (uploaded) {
    return `<figure><img src="${escape(uploaded)}" alt="Map of ${escape(door.venue.name)} and its meeting spots. No people are shown." loading="lazy" decoding="async">
<figcaption>The venue and its meeting spots. Never people.</figcaption></figure>`;
  }
  const svg = venueMap(door.venue, door.spots);
  if (!svg) return "";
  return `<figure>${svg}<figcaption>The venue and its meeting spots. Never people.</figcaption></figure>`;
}

function spotList(spots: Spot[], tz: string): string {
  if (spots.length === 0) return "";
  const items = spots
    .map((s) => {
      const bits = [`meet ${clock(s.meet_at, tz)}`];
      if (s.walk_minutes !== null) bits.push(`${s.walk_minutes} min walk`);
      return `<li><b>${escape(s.name)}</b>${s.description ? ` — ${escape(s.description)}` : ""}
<div class="meta">${escape(bits.join(" · "))}</div></li>`;
    })
    .join("");
  return `<h2>Meeting spots</h2><ul class="spots">${items}</ul>`;
}

// ---------------------------------------------------------------------------
// W3 — the share card: gathering, spot, time. No names, no join link.
// ---------------------------------------------------------------------------

export async function w3(request: Request, env: Env, slug: string): Promise<Response> {
  const door = await crowd(env, slug);
  const origin = new URL(request.url).origin;

  if (door.status === "redirect") return Response.redirect(`${origin}/g/${door.slug}/spot`, 301);
  if (door.status === "withdrawn") return notice("No longer on Pin'd", "This gathering is no longer on Pin'd.", 410);
  if (door.status === "gone") return notice("Not found", "There is no share card at this link.", 404);

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
${spots ? `<h2>Meeting spots</h2><ul class="spots">${spots}</ul>` : `<p class="quiet">No meeting spots yet.</p>`}`,
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
<p>${escape(ONE_LINER)} Pin in to a gathering you are already going to, and if you want company, opt in to meeting. When ${THRESHOLD} people have opted in, crews open: small groups of three to eight who agree a public spot and walk in together.</p>

<h2>House rules</h2>
<ol class="rules">${HOUSE_RULES.map((r) => `<li>${escape(r)}</li>`).join("")}</ol>

<h2 id="safety">Safety</h2>
<p>Nobody sees your name or your photo until you have both pinned in and opted to meet at the same gathering. Every meeting happens at a named public spot, before the event, and Pin&#39;d is never there.</p>
<p>Blocking is mutual and silent: the other person is never told, and neither of you can see the other again. Report and block sit one tap from any person, crew or message in the app. Some reasons hide the person the moment they are used.</p>
<p>Pin&#39;d never asks for your location, and holds no coordinates except venues and their meeting spots.</p>
<p>19+ only.</p>

<h2>Get in touch</h2>
<p><a href="mailto:${SUGGEST_TO}">${SUGGEST_TO}</a> to suggest a gathering${DOT}<a href="mailto:${REPORT_TO}">${REPORT_TO}</a> for anything about safety</p>`,
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
