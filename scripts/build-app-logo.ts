// Rasterise the brand lockup for the Expo app (Phase 3 M3.1).
//
// **Why a PNG and not the SVG.** The Worker's pages inline the mark and wordmark as
// SVG paths (`src/public/brand.ts`, generated from `brand/*.svg`), which React Native
// cannot render without `react-native-svg` — a dependency, and a dependency is Alex's
// call rather than something a logo helps itself to. `@cf-wasm/resvg` is already here
// for the OG image, so the lockup becomes a PNG at build time and `expo-image`, also
// already here, draws it on both platforms.
//
// **It is generated, not drawn.** The source of truth stays `brand/*.svg` → `npm run
// brand` → `src/public/brand.ts` → this. A logo traced by hand into a second file is
// a second logo, and it drifts.
//
// White, because the app is dark always (decisions Part 5) and the paths carry
// `fill="currentColor"`, which a rasteriser has no current colour for — so it is set
// explicitly here.
//
//   npm run brand:app

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@cf-wasm/resvg/node";
import { MARK, WORDMARK } from "../src/public/brand.ts";

// **Two pieces, not one lockup.** The header is the mark at one end and the wordmark
// at the other, with the row between them — which is what `src/public/layout.ts` does
// and what the app now does too. The composed LOCKUP is the OG image's layout, where
// the two sit together in the middle of a picture; using it in a header puts both
// logos in the corner and leaves the rest of the row empty.
//
// Three times the layout size, so each stays sharp on a 3× screen. Both are a handful
// of paths and compress to a few KB.
const SCALE = 3;
const PIECES = [
  { name: "mark", art: MARK, height: 24 },
  { name: "wordmark", art: WORDMARK, height: 19 },
] as const;

async function main() {
  // The node build loads its own wasm; only the workerd build needs initialising.
  for (const piece of PIECES) {
    const { art, height } = piece;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${art.width} ${art.height}" ` +
      `width="${art.width}" height="${art.height}" fill="none" color="#FFFFFF">${art.body}</svg>`;

    // `Resvg.async` rather than `new Resvg`: the node build loads its wasm lazily and
    // the synchronous constructor throws if it is not ready yet.
    const image = await Resvg.async(svg, {
      fitTo: { mode: "height", value: Math.round(height * SCALE) },
      background: "rgba(0,0,0,0)",
    });
    const png = image.render().asPng();
    const out = join(process.cwd(), "app", "assets", `${piece.name}.png`);
    await writeFile(out, png);
    const width = Math.round((art.width / art.height) * height * SCALE);
    console.log(`${piece.name.padEnd(9)} ${width}×${Math.round(height * SCALE)}  ${(png.length / 1024).toFixed(1)} KB`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
