import type { SupabaseClient } from "@supabase/supabase-js";
import { adjustedScore, distanceAdjustment, venueDistanceKm, type CityGeo } from "../import/ticketmaster";
import { DEFAULT_TZ } from "./time";
import { e, must } from "./ui";

export interface VenueRow {
  id: string;
  name: string;
  city: string;
  address: string | null;
  map_image_path: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Ranked {
  final: number | null; // AI score after the distance adjustment
  ai: number | null;
  adjustment: number;
  km: number | null;
}

export interface Places {
  venues: VenueRow[];
  byId: Map<string, VenueRow>;
  // The venue's timezone; drafts without a venue use Toronto.
  tz(venueId: string | null | undefined): string;
  // Approved (active) meeting spots at the venue. Publishing needs 3.
  spots(venueId: string | null | undefined): number;
  // Distance from the city centre, and the AI score adjusted for it (decisions Part 5).
  // Worked out when shown, never stored, so changing the city's numbers re-ranks at once.
  rank(venueId: string | null | undefined, ai: number | null): Ranked;
}

export async function places(db: SupabaseClient): Promise<Places> {
  const [venues, cities, spots] = await Promise.all([
    must(db.from("venues").select("id, name, city, address, map_image_path, latitude, longitude").order("name")),
    must(db.from("cities").select("*")),
    must(db.from("meeting_spots").select("venue_id").eq("active", true)),
  ]);
  const zones = new Map<string, string>(cities.map((c: { slug: string; timezone: string }) => [c.slug, c.timezone]));
  const geo = new Map<string, CityGeo>();
  for (const c of cities as Record<string, any>[]) {
    if (c.centre_lat === null) continue;
    geo.set(c.slug, {
      centreLat: Number(c.centre_lat),
      centreLng: Number(c.centre_lng),
      coreRadiusKm: Number(c.core_radius_km),
      penaltyPerKm: Number(c.distance_penalty_per_km),
      penaltyMax: Number(c.distance_penalty_max),
    });
  }
  const byId = new Map<string, VenueRow>(venues.map((v: VenueRow) => [v.id, v]));
  const counts = new Map<string, number>();
  for (const s of spots as { venue_id: string }[]) counts.set(s.venue_id, (counts.get(s.venue_id) ?? 0) + 1);
  return {
    venues,
    byId,
    tz: (id) => zones.get((id && byId.get(id)?.city) || "") ?? DEFAULT_TZ,
    spots: (id) => (id ? (counts.get(id) ?? 0) : 0),
    rank: (id, ai) => {
      const v = id ? byId.get(id) : undefined;
      const g = v ? geo.get(v.city) : undefined;
      const km = v && g ? venueDistanceKm({ lat: v.latitude, lng: v.longitude }, g) : null;
      const adjustment = g ? distanceAdjustment(km, g) : 0;
      return { final: adjustedScore(ai, adjustment), ai, adjustment, km };
    },
  };
}

export function venueOptions(p: Places, selected: string | null | undefined): string {
  const none = `<option value="">— no venue yet —</option>`;
  return (
    none +
    p.venues
      .map(
        (v) =>
          `<option value="${e(v.id)}"${v.id === selected ? " selected" : ""}>${e(v.name)} (${p.spots(v.id)}/3 spots)</option>`,
      )
      .join("")
  );
}
