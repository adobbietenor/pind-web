// The few line icons UI pass 1 uses (docs/design/ui-pass-1), as SVG markup, so the
// Worker inlines them and the app draws the same paths through expo-image (which reads
// an SVG data URI; React Native has no SVG of its own and no dependency was added).
// One copy of each path, so a counter's person on W2 and on A9 cannot drift.
//
// 24×24 stroke icons, drawn in `currentColor` on the Worker (the CSS colours them) and
// in an explicit colour in the app.

const PATHS = {
  person: `<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>`,
  handshake:
    `<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/>` +
    `<path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>`,
  chevronDown: `<path d="M6 9l6 6 6-6"/>`,
  chat: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  pin: `<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>`,
} as const;

export type IconName = keyof typeof PATHS;

export function iconSvg(name: IconName, size: number, color = "currentColor"): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
  );
}

// For expo-image: the same markup as a data URI.
export function iconUri(name: IconName, size: number, color: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg(name, size, color).replace(' aria-hidden="true"', ' xmlns="http://www.w3.org/2000/svg"'))}`;
}
