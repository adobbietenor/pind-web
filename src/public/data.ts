// What the public pages read, and how.
//
// Two rules decide everything here:
//   - the public pages read through the ANON key, never the service key, so RLS is
//     what decides what a visitor gets (decisions Part 5; spec §4);
//   - and they read through exactly two database functions, public_gatherings and
//     public_gathering, which are the single definition of "on the public web":
//     published, not withdrawn, not seeded (V18), and carrying a slug. No filtering
//     happens in this file (H11).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { ConfigError, projectUrl } from "../supabase";

export function anonClient(env: Env): SupabaseClient {
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) throw new ConfigError("SUPABASE_PUBLISHABLE_KEY is missing");
  if (!key.startsWith("sb_publishable_")) {
    throw new ConfigError("SUPABASE_PUBLISHABLE_KEY is not a publishable key");
  }
  return createClient(projectUrl(env), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-pind": "public" } },
  });
}

// One row of W1.
export interface Crowd {
  slug: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  entry: "free" | "door" | "ticketed";
  door_price_cents: number | null;
  entry_note: string | null;
  source: "manual" | "ticketmaster" | "ai";
  venue_name: string;
  city_name: string;
  city_timezone: string;
  pinned: number;
  open_to_meeting: number;
  crews_open: boolean;
}

export interface Counts {
  pinned: number;
  open_to_meeting: number;
  women: number | null;
  men: number | null;
  other: number | null;
  crews_open: boolean;
}

export interface Spot {
  name: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  walk_minutes: number | null;
  meet_at: string;
}

export interface Crowd2 {
  status: "ok";
  gathering: {
    id: string;
    slug: string;
    name: string;
    starts_at: string;
    ends_at: string | null;
    effective_end: string;
    entry: "free" | "door" | "ticketed";
  door_price_cents: number | null;
  entry_note: string | null;
    source: "manual" | "ticketmaster" | "ai";
    event_url: string | null;
  };
  venue: {
    id: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    map_image_path: string | null;
    // The key the venue's coordinates produce, and the keys already rendered. W2 uses
    // both to decide, in this one round trip, whether to show the picture or fall back
    // (src/public/venuemap.ts).
    map_key: string | null;
    map_ready: string[];
    city_name: string;
    timezone: string;
  };
  spots: Spot[];
  counts: Counts;
}

export type Door =
  | Crowd2
  | { status: "redirect"; slug: string }
  | { status: "withdrawn" }
  | { status: "gone" };

// W1: the crowds between two instants, by date, never by size (Q10).
export async function crowds(env: Env, from: Date, to: Date): Promise<Crowd[]> {
  const { data, error } = await anonClient(env).rpc("public_gatherings", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw new Error(`public_gatherings: ${error.message}`);
  return (data ?? []) as Crowd[];
}

// venue-maps is a public bucket (V12), so an uploaded map has a public URL and needs
// no signed link. venues.map_image_path holds the object's path inside the bucket,
// not a URL — the admin builds the URL with getPublicUrl, and so must this.
export function venueMapUrl(env: Env, path: string | null): string | null {
  return path ? `${projectUrl(env)}/storage/v1/object/public/venue-maps/${path.split("/").map(encodeURIComponent).join("/")}` : null;
}

// W2, W3, W4 and the .ics: one gathering by slug, in one round trip.
export async function crowd(env: Env, slug: string): Promise<Door> {
  const { data, error } = await anonClient(env).rpc("public_gathering", { p_slug: slug });
  if (error) throw new Error(`public_gathering: ${error.message}`);
  return (data ?? { status: "gone" }) as Door;
}
