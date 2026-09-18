// Ticketmaster Discovery API — the only code that calls it (Phase 1 M1.3).
//
// One search per week of the window (the API returns at most 1,000 results per
// search), 200 per page, one call every 0.6 s: well inside 5,000 a day and the
// documented 2 per second. The key goes in the query string, as the API requires; it
// never appears in an error message or a log line.
import type { TmEvent } from "./ticketmaster";

const BASE = "https://app.ticketmaster.com/discovery/v2/events.json";
const PAGE_SIZE = 200;
const DEEP_LIMIT = 1000; // size × page must stay under 1,000
const GAP_MS = 600;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface Area {
  lat: number;
  lng: number;
  radiusKm: number;
  weeks: number;
}

export interface FetchResult {
  events: TmEvent[];
  calls: number;
  complete: boolean; // every page of every week arrived; only then can a listing count as missing
  errors: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

interface Page {
  _embedded?: { events?: TmEvent[] };
  page?: { totalElements?: number; totalPages?: number };
}

export async function fetchWindow(apiKey: string, area: Area, now: Date): Promise<FetchResult> {
  const out: FetchResult = { events: [], calls: 0, complete: true, errors: [] };
  const seen = new Set<string>();

  async function get(params: URLSearchParams, label: string): Promise<Page | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (out.calls > 0) await sleep(attempt ? 3000 : GAP_MS);
      out.calls++;
      let res: Response;
      try {
        res = await fetch(`${BASE}?${params}&apikey=${encodeURIComponent(apiKey)}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        if (attempt) out.errors.push(`${label}: no response`);
        continue;
      }
      if (res.ok) return (await res.json()) as Page;
      if (attempt || (res.status !== 429 && res.status < 500)) {
        out.errors.push(`${label}: HTTP ${res.status}`);
        return null;
      }
    }
    return null;
  }

  for (let week = 0; week < area.weeks; week++) {
    const from = new Date(now.getTime() + week * WEEK_MS);
    const to = new Date(from.getTime() + WEEK_MS);
    for (let page = 0; ; page++) {
      const params = new URLSearchParams({
        latlong: `${area.lat},${area.lng}`,
        radius: String(area.radiusKm),
        unit: "km",
        startDateTime: stamp(from),
        endDateTime: stamp(to),
        size: String(PAGE_SIZE),
        page: String(page),
        sort: "date,asc",
        locale: "*",
      });
      const body = await get(params, `week ${week + 1} page ${page + 1}`);
      if (!body) {
        out.complete = false;
        break;
      }
      for (const e of body._embedded?.events ?? []) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          out.events.push(e);
        }
      }
      const total = body.page?.totalElements ?? 0;
      const pages = body.page?.totalPages ?? 0;
      if (page === 0 && total > DEEP_LIMIT) {
        out.complete = false;
        out.errors.push(`week ${week + 1}: ${total} listings, more than one search can return`);
      }
      if (page + 1 >= pages || (page + 2) * PAGE_SIZE > DEEP_LIMIT) break;
    }
  }
  return out;
}
