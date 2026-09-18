import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TZ } from "./time";
import { e, must } from "./ui";

export interface VenueRow {
  id: string;
  name: string;
  city: string;
  address: string | null;
  map_image_path: string | null;
}

export interface Places {
  venues: VenueRow[];
  byId: Map<string, VenueRow>;
  // The venue's timezone; drafts without a venue use Toronto.
  tz(venueId: string | null | undefined): string;
  // Approved (active) meeting spots at the venue. Publishing needs 3.
  spots(venueId: string | null | undefined): number;
}

export async function places(db: SupabaseClient): Promise<Places> {
  const [venues, cities, spots] = await Promise.all([
    must(db.from("venues").select("id, name, city, address, map_image_path").order("name")),
    must(db.from("cities").select("slug, timezone")),
    must(db.from("meeting_spots").select("venue_id").eq("active", true)),
  ]);
  const zones = new Map<string, string>(cities.map((c: { slug: string; timezone: string }) => [c.slug, c.timezone]));
  const byId = new Map<string, VenueRow>(venues.map((v: VenueRow) => [v.id, v]));
  const counts = new Map<string, number>();
  for (const s of spots as { venue_id: string }[]) counts.set(s.venue_id, (counts.get(s.venue_id) ?? 0) + 1);
  return {
    venues,
    byId,
    tz: (id) => zones.get((id && byId.get(id)?.city) || "") ?? DEFAULT_TZ,
    spots: (id) => (id ? (counts.get(id) ?? 0) : 0),
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
