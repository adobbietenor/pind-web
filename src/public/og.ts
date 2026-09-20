// W4 — the link preview image, one per gathering.
//
// Dark and branded: the lockup, the event name, the date and the venue, and the
// one-liner. **No counts** — a preview is cached by Reddit, Discord and iMessage at
// post time, and a stale number would be a dishonest one (H6). Counts live in the
// post title and on the page, where they are live.
//
// Drawn as an SVG, for the same reason the venue map is: it is text, it is diffable,
// and it can be unit-tested without a bundler. It is rasterised to a PNG before it is
// served, because SVG is not a link preview — see src/public/ogpng.ts.

import { lockupSvg } from "./brand.ts";
import { escape } from "./escape.ts";

const W = 1200;
const H = 630;

// Poppins' average advance, as a fraction of the font size. Only used to decide where
// to break a line, so being a little out is harmless.
const ADVANCE = 0.55;

function wrap(text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const perLine = Math.floor(maxWidth / (size * ADVANCE));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > perLine && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  // Anything that did not fit ends in an ellipsis rather than being cut mid-word.
  if (lines.length === maxLines) {
    const used = lines.join(" ").length;
    if (used < text.length - 1) lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/[\s,.;:-]+$/, "")}…`;
  }
  return lines;
}

export interface OgCard {
  name: string;
  when: string;
  venue: string;
  // The fixed one-liner (spec §5), passed in rather than imported: this module is
  // a pure renderer the unit tests load directly. See src/public/escape.ts.
  oneLiner: string;
}

export function ogImage(card: OgCard): string {
  // Long names get a smaller size before they get an ellipsis.
  const size = card.name.length > 46 ? 62 : card.name.length > 28 ? 72 : 84;
  const lines = wrap(card.name, size, W - 160, 3);
  const blockHeight = lines.length * size * 1.16;
  const top = 250 - blockHeight / 2 + size * 0.85;

  const nameLines = lines
    .map(
      (line, i) =>
        `<text x="80" y="${(top + i * size * 1.16).toFixed(0)}" font-size="${size}" font-weight="650" fill="#FFFFFF" letter-spacing="-1.5">${escape(line)}</text>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escape(card.name)}">
<rect width="${W}" height="${H}" fill="#0B0A0D"/>
<rect x="0" y="0" width="${W}" height="8" fill="#582883"/>
<g font-family="Poppins">
<g transform="translate(80,74)" color="#FFFFFF">${lockupSvg(40, null)}</g>
${nameLines}
<text x="80" y="430" font-size="34" fill="#C9C4D1">${escape(card.when)}</text>
<text x="80" y="478" font-size="34" fill="#C9C4D1">${escape(card.venue)}</text>
<text x="80" y="566" font-size="28" fill="#A7A2AF">${escape(card.oneLiner)}</text>
</g>
</svg>`;
}

// Universal links (W4). iOS fetches this file from pind.social and, when the app is
// installed, opens a crowd URL in the app instead of Safari. Both bundle IDs are
// listed so a staging build on the same domain behaves the same way
// (decisions Part 5, "Bundle identifiers"; Apple team 93M6B4W5PR).
const APP_IDS = ["93M6B4W5PR.social.pind.app", "93M6B4W5PR.social.pind.app.staging"];

export function appSiteAssociation(): Response {
  const body = {
    applinks: {
      details: [
        {
          appIDs: APP_IDS,
          components: [
            { "/": "/g/*", comment: "crowd pages, the pin path and share cards" },
            { "/": "/crew/*", comment: "a crew" },
            { "/": "/me", comment: "the profile" },
            { "/": "/admin*", exclude: true, comment: "the admin stays in the browser" },
          ],
        },
      ],
    },
    webcredentials: { apps: APP_IDS },
  };
  return new Response(JSON.stringify(body), {
    headers: {
      // Apple requires application/json and no redirect.
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
    },
  });
}
