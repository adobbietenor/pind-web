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
import { lockupSvg } from "./brand";
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

/* Header: the logo, and nothing else competing with it. */
.top{padding:22px 0 8px}
.top a{display:inline-block;color:var(--text);line-height:0}
.top svg{display:block}

h1{font-size:1.75rem;line-height:1.2;letter-spacing:-.015em;margin:14px 0 6px;font-weight:650}
h2{font-size:.8rem;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:30px 0 10px;font-weight:600}
p{margin:0 0 14px}
.lede{color:var(--muted);margin:0 0 4px}

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

/* A spot. The whole thing is the tap target, and it opens the phone's own maps app. */
.pin{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;gap:6px;text-decoration:none;color:#fff;max-width:60%}
.pin .dotm{flex:0 0 auto;width:13px;height:13px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px rgba(11,10,13,.85)}
.pin .lbl{display:block;background:rgba(11,10,13,.82);border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:5px 9px;line-height:1.25}
.pin .lbl b{display:block;font-size:.8rem;font-weight:640;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pin .lbl i{display:block;font-style:normal;font-size:.7rem;color:var(--muted)}
.pin .lbl u{display:block;font-size:.7rem;color:#c9a6ee;text-decoration:none;margin-top:2px}
.pin:hover .lbl{background:rgba(88,40,131,.92);border-color:var(--accent)}
.pin:hover .lbl u{color:#fff}
/* Labels near the right edge flip to the other side of their dot. */
.pin.flip{flex-direction:row-reverse}

a.dirs{margin-left:6px;font-size:.82rem;white-space:nowrap}

/* House rules */
.rules{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:6px 18px 6px 34px;margin:22px 0 0}
.rules li{margin:12px 0;font-size:.95rem}
.rules li::marker{color:var(--accent);font-weight:700}

/* The one button */
.cta{
  display:block;width:100%;text-align:center;margin:24px 0 10px;
  padding:16px 20px;border:0;border-radius:12px;
  background:var(--accent);color:#fff;font:inherit;font-weight:640;letter-spacing:-.01em;
  text-decoration:none;cursor:pointer;
}
.cta:hover{background:var(--accent-lift);color:#fff}
.note{font-size:.86rem;color:var(--muted);text-align:center;margin:0}

.spots{list-style:none;padding:0;margin:14px 0 0}
.spots li{padding:10px 0;border-top:1px solid var(--border);font-size:.95rem}
.spots .meta{color:var(--muted);font-size:.86rem}

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

export function header(): string {
  return `<div class="top"><a href="/">${lockupSvg(26)}</a></div>`;
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
