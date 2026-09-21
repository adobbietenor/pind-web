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
  category: string | null;
  signup_required: boolean;
  // One short line saying what this is, where a source knew something. Null is the
  // common case and shows nothing: a blank beats a restatement of the title.
  blurb: string | null;
  source: "manual" | "ticketmaster" | "ai";
  // The venue's id, not just its name: a chip earns its place at three gatherings in
  // at least two distinct *places*, and counting places by name is the kind of
  // nearly-right that bites when two rooms share one (M2.3).
  venue_id: string;
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
    category: string | null;
    signup_url: string | null;
    signup_required: boolean;
    blurb: string | null;
    // What makes this one worth turning up to, where the source said anything. The
    // crowd page has room for both lines; a card has room for one.
    blurb_why: string | null;
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
    // Every active spot at this venue, coordinates only. It is here so the map's zoom
    // is a property of the venue rather than of this gathering's poll — see
    // chooseZoom in venuemap.ts. Not the poll: that is `spots` below.
    map_spots: { latitude: number | null; longitude: number | null }[];
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

// ---------------------------------------------------------------------------
// "Which venues can a visitor reach?" — asked once, here
//
// **This is the second thing in one milestone to get "what is public" wrong by
// hand-rolling it**, so it lives in the door module and nowhere else. Both times the
// filter looked identical to the real definition and was not: `slug is not null and
// withdrawn_at is null` reads like "published", and a gathering Alex unpublished keeps
// its slug (M2.2, "once public, only Alex brings it back") — so Scotiabank Arena was
// counted as needing a crowd page map for a page nobody can open.
//
// The rule, stated once: **a server-side job that needs to know what is public asks
// the door, as a visitor, through the anon key, and lets RLS answer.** The service key
// is then for the operational detail behind those rows — coordinates, render records,
// scores — which is its own job (V12) and never a second opinion about visibility.
// tests/unit/door.test.ts fails the build if the lookalike filter appears anywhere
// outside this file.
// ---------------------------------------------------------------------------

export async function publicVenueIds(env: Env, from: Date, to: Date): Promise<string[]> {
  return [...new Set((await crowds(env, from, to)).map((g) => g.venue_id))];
}

// W2, W3, W4 and the .ics: one gathering by slug, in one round trip.
export async function crowd(env: Env, slug: string): Promise<Door> {
  const { data, error } = await anonClient(env).rpc("public_gathering", { p_slug: slug });
  if (error) throw new Error(`public_gathering: ${error.message}`);
  return (data ?? { status: "gone" }) as Door;
}

// Which city this is, for the label W1 wears (M3.1). Read **through the anon key like
// everything else on these pages**, so a visitor's own privileges decide it and there
// is no second opinion about what is public (the door rule).
//
// It is on the `cities` row rather than in the page for the reason the search radius
// and the timezone are: **another city is a row, not a rebuild** (decisions Part 5).
export interface City {
  name: string;
  country: string;
  countryCode: string;
}

export async function city(env: Env, slug = "toronto"): Promise<City | null> {
  const { data, error } = await anonClient(env)
    .from("cities")
    .select("name, country, country_code")
    .eq("slug", slug)
    .maybeSingle();
  // A label is not worth failing a page for: no city means no label, and the list
  // underneath it is the thing somebody came for.
  if (error || !data) return null;
  return { name: data.name, country: data.country, countryCode: data.country_code };
}
