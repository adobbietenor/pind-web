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
import { LOCKUP } from "../src/public/brand.ts";

// Three times the layout size, so it stays sharp on a 3× screen without shipping
// anything enormous: the lockup is two dozen paths and compresses to a few KB.
const SCALE = 3;
const HEIGHT = 78.88;

async function main() {
  // The node build loads its own wasm; only the workerd build needs initialising.
  const width = (LOCKUP.width / LOCKUP.height) * HEIGHT;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOCKUP.width} ${LOCKUP.height}" ` +
    `width="${LOCKUP.width}" height="${LOCKUP.height}" fill="none" color="#FFFFFF">${LOCKUP.body}</svg>`;

  // `Resvg.async` rather than `new Resvg`: the node build loads its wasm lazily and
  // the synchronous constructor throws if it is not ready yet.
  const image = await Resvg.async(svg, {
    fitTo: { mode: "height", value: Math.round(HEIGHT * SCALE) },
    background: "rgba(0,0,0,0)",
  });
  const png = image.render().asPng();

  const out = join(process.cwd(), "app", "assets", "lockup.png");
  await writeFile(out, png);
  console.log(
    `${out}  ${Math.round((width * SCALE))}×${Math.round(HEIGHT * SCALE)}  ${(png.length / 1024).toFixed(1)} KB`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
