// W4 — turning the OG card into a PNG.
//
// The card itself is drawn in og.ts as an SVG, which is the only thing that has to
// be got right. This file rasterises it, because SVG is not a link preview: iMessage,
// Discord and Slack all want a bitmap.
//
// Why a WebAssembly rasteriser and not Cloudflare Images: Cloudflare will not do it.
// Its own docs say "Cloudflare does not resize SVG files and will ignore any
// optimization parameters", and Images "does not have plans to convert svg to raster"
// — it sanitises SVGs with svg-hush and serves them as they are. Checked 2026-09-19.
//
// What it costs, measured on this Worker: the bundle goes from 288 KB gzipped to
// about 900 KB, and Worker Startup Time from 8 ms to roughly 30 ms. That 20-odd
// milliseconds is paid on every cold isolate, for every route, because Workers block
// dynamic WebAssembly compilation — the module has to be a static import resolved at
// build, so it cannot be loaded only for /og/. The startup limit is 1 second, and W2
// measured the same before and after, so it is well inside the budget.
//
// Fonts are embedded rather than fetched. A rasteriser with no font renders no text,
// and reaching for Google's font CDN from inside the Worker would add a network round
// trip on every cold isolate and a runtime dependency on somebody else's uptime to a
// link preview. Poppins is the brand's headline face (spec §3), and these are the same
// two faces the app bundles.

import { Resvg } from "@cf-wasm/resvg/workerd";
import semiBold from "./fonts/Poppins_600SemiBold.ttf";
import regular from "./fonts/Poppins_400Regular.ttf";

const FONTS = [new Uint8Array(semiBold), new Uint8Array(regular)];

export function rasterise(svg: string): Uint8Array {
  const image = new Resvg(svg, {
    // The SVG already carries the size it wants; resvg honours the viewBox.
    font: {
      fontBuffers: FONTS,
      defaultFontFamily: "Poppins",
      loadSystemFonts: false, // there are none in a Worker, and looking costs time
    },
  });
  return image.render().asPng();
}

export function pngResponse(png: Uint8Array): Response {
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      // A preview is fetched once and cached by whoever posted the link. The image
      // holds no counts, so it never goes stale (H6) and the edge can hold it.
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
