// The site's one icon: the white mark on the near-black tile (#5).
//
// The Worker serves it as /favicon.svg, and `npm run brand:app` rasterises the same
// drawing into app/assets/favicon.png, from which Expo's web export makes the
// /favicon.ico its pages link. Before 29 Oct the app's was the purple app-icon tile, so
// the tab's icon changed colour between /g/… (the Worker) and /pin/… (the app) — two
// halves of one site with two icons (Tatiana, #5).
import { markSvg } from "./brand.ts";

export function faviconSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="#0B0A0D"/>` +
    `<g transform="translate(12,12)" color="#FFFFFF">${markSvg(40)}</g>` +
    `</svg>`
  );
}
