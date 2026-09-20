// The dark shell every public page (W1–W4) is rendered into.
//
// Plain HTML from template strings and plain CSS: no framework, no component
// library, no build step, no client-side router (CLAUDE.md, "Keep the Worker
// lean"). These pages are pasted into Reddit threads and have to open inside
// Reddit's in-app browser in under a second.
//
// Near-black background, purple #582883, white text, the logo inline — matching the
// app and pindscene.com (spec §2; decisions Part 5, "Look" and "Dark only"). System
// fonts only: one web font would cost a round trip before the first paint, and the
// spec allows it only if it does not hurt load time. Poppins stays in the app.
//
// The palette is the one in packages/shared, never retyped.

import { colors } from "@pind/shared";
import { markSvg, wordmarkSvg } from "./brand";
import { escape } from "./escape.ts";

export { escape };

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:${colors.background};--surface:${colors.surface};--border:${colors.border};
  --text:${colors.text};--muted:${colors.textMuted};--accent:${colors.accent};
  --accent-lift:#6d3aa0;
}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--bg);color:var(--text);
  font:17px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:620px;margin:0 auto;padding:0 20px 56px}
a{color:#c9a6ee;text-underline-offset:2px}
a:hover{color:#fff}

/* Header: the mark at one end, the wordmark at the other, and nothing else competing
   with either. The anchor is the whole row, so the tap target spans the header. */
.top{padding:22px 0 8px}
.top a{display:flex;align-items:center;justify-content:space-between;color:var(--text);line-height:0}
.top svg{display:block}

h1{font-size:1.75rem;line-height:1.2;letter-spacing:-.015em;margin:14px 0 6px;font-weight:650}
h2{font-size:.8rem;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:30px 0 10px;font-weight:600}
p{margin:0 0 14px}
.lede{color:var(--muted);margin:0 0 4px}

/* W1's two tabs. Events and Community are one product and one list shape; the tabs
   are a way into a long list, not a mode switch, so they read as a segmented control
   rather than as navigation to somewhere else. */
.tabs{display:flex;gap:4px;margin:18px 0 0;padding:4px;background:var(--surface);border:1px solid var(--border);border-radius:12px}
.tabs .tab{
  flex:1;text-align:center;padding:9px 10px;border-radius:9px;text-decoration:none;
  color:var(--muted);font-size:.95rem;font-weight:560;letter-spacing:-.01em;
}
.tabs .tab:hover{color:#fff}
.tabs .tab.on{background:var(--accent);color:#fff}

/* The chips. A filter that narrows, never a sort that reorders — so they wrap onto as
   many lines as they need and nothing here scrolls sideways or needs a script. */
.chips{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0 0}
.chips .chip{
  display:inline-block;padding:6px 12px;border-radius:999px;text-decoration:none;
  border:1px solid var(--border);background:var(--surface);color:#d7d2df;
  font-size:.88rem;line-height:1.3;
}
.chips .chip:hover{border-color:#6b6378;color:#fff}
.chips .chip.on{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:560}

/* Which week, when it is not this one. */
.weekline{margin:14px 0 0;color:var(--muted);font-size:.9rem}

/* The day heading: the day, the date under it where it helps, and how many are on.
   Sticky, because a fifty-row list scrolls past its own headings otherwise — CSS
   alone, no script. */
h2.day{
  display:flex;align-items:baseline;gap:8px;position:sticky;top:0;z-index:2;
  margin:26px 0 10px;padding:8px 0 7px;background:var(--bg);
  font-size:1rem;letter-spacing:-.01em;text-transform:none;color:var(--text);font-weight:640;
  border-bottom:1px solid var(--border);
}
h2.day .daydate{font-size:.82rem;font-weight:400;color:var(--muted);letter-spacing:0}
h2.day .daycount{margin-left:auto;font-size:.8rem;font-weight:500;color:var(--muted)}

/* One week forward, one back. */
.pager{display:flex;gap:10px;margin:28px 0 0}
.pager .page{
  flex:1;padding:13px 14px;border:1px solid var(--border);border-radius:12px;
  background:var(--surface);text-decoration:none;color:#d7d2df;font-size:.92rem;
}
.pager .page:hover{border-color:#6b6378;color:#fff}
.pager .next{text-align:right}

/* Cards */
.card{
  display:block;background:var(--surface);border:1px solid var(--border);border-radius:14px;
  padding:15px 16px;margin:0 0 10px;text-decoration:none;color:inherit;
}
a.card:hover{border-color:#453f52;background:#1c1922}
.card .when{font-size:.82rem;color:var(--muted);letter-spacing:.02em}
.card .name{font-size:1.06rem;font-weight:620;line-height:1.3;margin:3px 0 2px;letter-spacing:-.01em}
.card .where{font-size:.9rem;color:var(--muted)}
.card .tally{font-size:.88rem;margin-top:9px;color:#d7d2df}
.dot{color:#5b5566;padding:0 6px}
.tag{
  display:inline-block;font-size:.68rem;letter-spacing:.07em;text-transform:uppercase;
  border:1px solid var(--border);border-radius:999px;padding:2px 8px;color:var(--muted);
  margin-left:8px;vertical-align:1px;
}

/* What it costs to walk in, under the button and never inside it: the button is a
   commitment, the price is a fact. Quiet enough not to compete with the call to
   action, close enough that nobody can take one without the other. */
.cost{margin:8px 0 0;font-size:.92rem;color:var(--muted);text-align:center}

/* Registering elsewhere: above the call to action, because it is a precondition
   rather than a footnote. */
.signup{margin:0 0 10px;font-size:.94rem;text-align:center;color:#d7d2df}
.signup a{color:#fff}

/* The question the counts answer. A heading, not a lede: it is the thing the reader
   came to the page for, and the counts under it are the answer. */
h2.asks{
  margin:24px 0 10px;font-size:1.12rem;text-transform:none;letter-spacing:-.01em;
  color:var(--text);font-weight:640;
}

/* What happens at five: a fact underneath, never the message. The threshold is our
   mechanic and not the reader's reason (Alex, after the M2.3 walk). */
.rule{margin:8px 0 0;font-size:.84rem;color:#736d7e}

/* Counts on the crowd page */
.tallies{display:flex;gap:10px;margin:18px 0 6px}
.tally-box{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:13px 14px}
.tally-box b{display:block;font-size:1.6rem;line-height:1.1;font-weight:650;letter-spacing:-.02em}
.tally-box span{font-size:.8rem;color:var(--muted)}
.mix{color:var(--muted);font-size:.9rem;margin:10px 0 0}

/* The map */
figure{margin:20px 0 0}
figure svg{display:block;width:100%;height:auto;background:var(--surface);border:1px solid var(--border);border-radius:14px}
figcaption{font-size:.82rem;color:var(--muted);margin-top:8px}
.credit{font-size:.76rem;color:#736d7e}
/* "Open in Maps": the phone's own map app, which is the interactive map this page
   cannot afford to be. Beside the caption, not competing with the button. */
.openmap{white-space:nowrap}
.credit a{color:#736d7e}

/* The real map: one image, everything meaningful in HTML on top of it. The aspect
   ratio is fixed here as well as on the img, so the box never moves when the bytes
   land. */
.mapbox{position:relative;aspect-ratio:768/480;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface)}
.mapbox img{display:block;width:100%;height:100%;object-fit:cover}
.venue-pin{position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(11,10,13,.85)}
.venue-name{position:absolute;left:50%;top:50%;transform:translate(-50%,14px);font-size:.8rem;font-weight:650;color:#fff;text-shadow:0 1px 3px #0B0A0D,0 0 8px #0B0A0D;white-space:nowrap;pointer-events:none}
.north{position:absolute;right:10px;top:8px;font-size:.7rem;color:var(--muted);background:rgba(11,10,13,.72);border-radius:6px;padding:3px 7px;letter-spacing:.06em}
.north::before{content:"▲";display:block;font-size:.62rem;line-height:1;margin-bottom:1px}

/* A spot on the map: a numbered dot, and nothing else. The name, the walk, the meet
   time and the directions link are in its card below, which is what a crew choosing
   between three spots actually needs — and a dot cannot overlap its neighbour the way
   three name labels do on a phone. The tap target is 34px, above the 24px minimum,
   although the dot draws smaller. */
.pin{
  position:absolute;transform:translate(-50%,-50%);width:34px;height:34px;
  display:flex;align-items:center;justify-content:center;text-decoration:none;
}
.pin .num{
  width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;
  display:flex;align-items:center;justify-content:center;
  font-size:.78rem;font-weight:700;line-height:1;
  box-shadow:0 0 0 2px rgba(11,10,13,.9),0 1px 4px rgba(0,0,0,.5);
}
.pin:hover .num,.pin:focus-visible .num{background:#fff;color:var(--accent)}

a.dirs{display:inline-block;margin-top:8px;font-size:.88rem}

/* House rules */
.rules{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:6px 18px 6px 34px;margin:22px 0 0}
.rules li{margin:12px 0;font-size:.95rem}
.rules li::marker{color:var(--accent);font-weight:700}
/* The one line under them. A fact about how it works, not a fourth rule — so it sits
   outside the card, quieter, and is not numbered. */
.crews-meet{font-size:.88rem;color:var(--muted);margin:10px 2px 0}

/* The one button */
.cta{
  display:block;width:100%;text-align:center;margin:24px 0 10px;
  padding:16px 20px;border:0;border-radius:12px;
  background:var(--accent);color:#fff;font:inherit;font-weight:640;letter-spacing:-.01em;
  text-decoration:none;cursor:pointer;
}
.cta:hover{background:var(--accent-lift);color:#fff}
.note{font-size:.86rem;color:var(--muted);text-align:center;margin:0}

/* A spot is a card, not a maps link (decisions Part 5). What it is like, and whether
   six can get a table, arrive with the manual pass; the shape is here waiting for
   them, and an empty field prints nothing rather than something guessed. */
.spots{list-style:none;padding:0;margin:14px 0 0}
.spots .spot{
  background:var(--surface);border:1px solid var(--border);border-radius:14px;
  padding:14px 16px;margin:0 0 10px;font-size:.95rem;scroll-margin-top:64px;
}
/* Arriving from the map: the card says so. :target is the no-JavaScript path; .lit is
   the same thing reached without pushing a history entry (see W2's script). */
.spots .spot:target,.spots .spot.lit{border-color:var(--accent);background:#1c1922}
.spots .spot-top{display:flex;align-items:center;gap:9px}
.spots .spot-top .num{
  flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;
  display:flex;align-items:center;justify-content:center;font-size:.74rem;font-weight:700;
}
.spots .spot-top b{font-size:1.02rem;font-weight:620;letter-spacing:-.01em}
.spots .spot-what{margin:8px 0 0;color:#d7d2df;font-size:.92rem}
.spots .meta{color:var(--muted);font-size:.86rem;margin-top:7px}

.quiet{color:var(--muted)}
.empty{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;color:var(--muted)}

footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--border);font-size:.84rem;color:var(--muted)}
footer a{color:var(--muted)}
footer a:hover{color:#fff}

@media (max-width:420px){
  .wrap{padding:0 16px 48px}
  h1{font-size:1.5rem}
  .tallies{gap:8px}
  .tally-box b{font-size:1.35rem}
}
`
  .replace(/\s*\n\s*/g, "\n")
  .trim();

export interface PageOptions {
  title: string;
  // <meta name="description"> and the OG description.
  description?: string;
  // Absolute URL of this page, for og:url and the canonical link.
  canonical?: string;
  // Absolute URL of the OG image (W4). Without one, no image tags are written.
  image?: string;
  status?: number;
  // Extra <head> markup: OG article tags, an .ics link.
  head?: string;
  // One small inline script, at the end of the body. Pages work without it.
  script?: string;
  // Cache-Control. Public pages are cached at the edge; counts move, so it is short.
  cache?: string;
  // The footer line, built by the page.
  footer?: string;
}

// Each page names its own footer (spec §2: W1 has "suggest a gathering · about ·
// 19+", W2 has "block · report · leave any time · 19+").
export const DOT = `<span class="dot">·</span>`;

// **The mark top left, the wordmark top right** (Alex, closing M2.3), rather than the
// composed lockup M2.1 put in the corner. One anchor spanning the header, so there is
// one link to home with one accessible name rather than two adjacent links to the same
// place; both pieces of artwork are decorative inside it. The composed lockup is still
// what the OG image uses, where it has a whole card to sit in the middle of.
export function header(): string {
  return `<div class="top"><a href="/" aria-label="Pin&#39;d">${markSvg(24)}${wordmarkSvg(19, null)}</a></div>`;
}

// Every M2.1 page is noindex and unlinked until the privacy policy lands in M4.1
// (decisions Part 5, "Public pages before the privacy policy"). robots.txt says the
// same thing; this is the belt to its braces, because a link someone pastes is not
// covered by robots.txt.
export function page(body: string, o: PageOptions): Response {
  const og = [
    `<meta property="og:site_name" content="Pin&#39;d">`,
    `<meta property="og:title" content="${escape(o.title)}">`,
    o.description ? `<meta property="og:description" content="${escape(o.description)}">` : "",
    o.canonical ? `<meta property="og:url" content="${escape(o.canonical)}">` : "",
    `<meta property="og:type" content="website">`,
    o.image ? `<meta property="og:image" content="${escape(o.image)}">` : "",
    o.image ? `<meta property="og:image:width" content="1200">` : "",
    o.image ? `<meta property="og:image:height" content="630">` : "",
    o.image ? `<meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`,
  ]
    .filter(Boolean)
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="${colors.background}">
<meta name="color-scheme" content="dark">
<title>${escape(o.title)}</title>
${o.description ? `<meta name="description" content="${escape(o.description)}">` : ""}
${o.canonical ? `<link rel="canonical" href="${escape(o.canonical)}">` : ""}
${og}
${o.head ?? ""}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body><div class="wrap">${body}<footer>${o.footer ?? `19+${DOT}leave any time`}</footer></div>${o.script ? `<script>${o.script}</script>` : ""}</body>
</html>`;

  return new Response(html, {
    status: o.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": o.cache ?? "public, max-age=0, s-maxage=60",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

// A page that says one thing. Used for 404s and for a withdrawn gathering.
export function notice(title: string, line: string, status = 404): Response {
  return page(
    `${header()}<h1>${escape(title)}</h1><p class="quiet">${escape(line)}</p><p><a href="/">See this week&#39;s crowds</a></p>`,
    { title: `${title} · Pin'd`, status, cache: "public, max-age=0, s-maxage=60" },
  );
}
