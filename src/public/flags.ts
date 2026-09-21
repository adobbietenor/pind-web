// Country flags, inline (Phase 3 M3.1).
//
// **Not an emoji** (Alex): 🇨🇦 renders as the bare letters "CA" on Windows, which is
// most of the desktop readers a Reddit link reaches. **Not an image either**: a flag
// CDN would break the own-origin rule for the sake of sixteen pixels, and that rule
// was measured — the same asset cost 911 ms from another host and 133 ms from ours.
//
// So they are drawn here. Keyed by `cities.country_code`, so a second city is a row
// and a second country is one entry in this map.
//
// **Drawn by us and checked by looking at it**, rendered at header size and at 20×,
// rather than trusted from a path typed out of memory — a national flag that is
// nearly right is the kind of detail that ships wrong and stays wrong.

const CANADA_LEAF = (() => {
  // The right half, apex at the top and the stem foot at the bottom, mirrored to make
  // the left. Symmetric by construction rather than by luck.
  const half: [number, number][] = [
    [0, 0],
    [6.5, 20],
    [25, 16.5],
    [20.5, 31],
    [43, 26],
    [38, 41],
    [50, 39],
    [38.5, 52],
    [51, 60],
    [31, 64],
    [34, 76],
    [15.5, 72],
    [13.5, 86],
    [5, 80],
    [5, 100],
    [0, 100],
  ];
  const right = half.map(([x, y]) => `${x},${y}`).join(" L");
  const left = [...half].reverse().map(([x, y]) => `${-x},${y}`).join(" L");
  return `M${right} L${left} Z`;
})();

const RED = "#D52B1E";

// 1:2, red-white-red in 1:2:1 bands.
function canada(height: number): string {
  const w = height * 2;
  const band = w / 4;
  const leafH = height * 0.74;
  const scale = leafH / 100;
  return (
    `<svg viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" aria-hidden="true" focusable="false">` +
    `<rect width="${w}" height="${height}" fill="#fff"/>` +
    `<rect width="${band}" height="${height}" fill="${RED}"/>` +
    `<rect x="${w - band}" width="${band}" height="${height}" fill="${RED}"/>` +
    `<g transform="translate(${w / 2} ${(height - leafH) / 2}) scale(${scale})" fill="${RED}">` +
    `<path d="${CANADA_LEAF}"/></g></svg>`
  );
}

const FLAGS: Record<string, (height: number) => string> = { CA: canada };

// An unknown country is no flag rather than a wrong one, and the label still reads
// correctly without it — the country's name is the thing that carries the meaning.
export function flagSvg(countryCode: string, height = 11): string {
  return FLAGS[countryCode.toUpperCase()]?.(height) ?? "";
}
