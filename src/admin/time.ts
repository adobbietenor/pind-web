// Wall-clock time in a venue's timezone <-> UTC, for admin forms and lists. No
// library: Intl knows every zone's offset, including daylight saving. Nothing here
// imports at runtime, so the unit tests load this file directly.

export const DEFAULT_TZ = "America/Toronto";

const partsFormat = new Map<string, Intl.DateTimeFormat>();

function wallClock(tz: string, ms: number): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  let f = partsFormat.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormat.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

// Minutes the zone is ahead of UTC at this instant (Toronto in summer: -240).
function offsetMinutes(tz: string, ms: number): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const w = wallClock(tz, whole);
  return (Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - whole) / 60_000;
}

const pad = (n: number) => String(n).padStart(2, "0");

// For <input type="datetime-local">: "2026-09-27T19:00".
export function toLocalInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const w = wallClock(tz, Date.parse(iso));
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
}

// From <input type="datetime-local"> in the venue's zone to a UTC ISO string.
// Returns null for anything that is not a valid date and time.
export function fromLocalInput(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(guess)) return null;
  let ms = guess - offsetMinutes(tz, guess) * 60_000;
  const second = offsetMinutes(tz, ms);
  if (guess - second * 60_000 !== ms) ms = guess - second * 60_000;
  // Reject impossible dates (e.g. Feb 31), which Date.UTC silently rolls over.
  return toLocalInput(new Date(ms).toISOString(), tz) === `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`
    ? new Date(ms).toISOString()
    : null;
}

// "2026-09-27" in the venue's zone — for grouping by day.
export function localDate(iso: string, tz: string): string {
  return toLocalInput(iso, tz).slice(0, 10);
}

// "Sat 27 Sep, 7:00 PM".
export function formatLocal(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
