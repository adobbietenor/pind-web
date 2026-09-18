// Staging seed for the admin (Phase 1 M1.2). FAKE DATA, pind-staging only.
//
//   npm run seed:staging               remove any previous seed, then seed
//   npm run seed:staging -- --remove   remove the seed and stop
//
// Refuses to run unless SUPABASE_URL in .dev.vars is pind-staging (the harness guard).
// Everything is tagged so one command removes it all:
//   - venues and gatherings: name starts "[TEST] "
//   - people: instagram handle "pindseed_…"; auth users: email "pindseed-…@example.com"
//   - moderation log: actor "pindseed@example.com", or any row about seeded rows
// The policy harness uses "pindhx"; neither touches the other's data.

import { deflateSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../tests/policies/env.ts";
import { must, newClient } from "../tests/policies/world.ts";
import { fromLocalInput, localDate } from "../src/admin/time.ts";

const TAG = "[TEST] ";
const SEED = "pindseed";
const ACTOR = `${SEED}@example.com`;
const TZ = "America/Toronto";

// ---------------------------------------------------------------------------
// A tiny PNG encoder (solid colour with a border), so photos and the map are
// visible in the admin without shipping image files.
// ---------------------------------------------------------------------------

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w: number, h: number, fill: [number, number, number], border: [number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const edge = x < 6 || y < 6 || x >= w - 6 || y >= h - 6;
      const [r, g, b] = edge ? border : fill;
      raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

async function remove(db: SupabaseClient): Promise<void> {
  const authIds: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list users: ${error.message}`);
    for (const u of data.users) if ((u.email ?? "").startsWith(`${SEED}-`)) authIds.push(u.id);
    if (data.users.length < 1000) break;
  }
  for (const id of authIds) {
    const { data } = await db.storage.from("photos").list(id);
    if (data?.length) await db.storage.from("photos").remove(data.map((f) => `${id}/${f.name}`));
  }

  const people = new Set<string>();
  for (const p of await must(db.from("people").select("id").like("instagram_handle", `${SEED}%`), "find people")) people.add(p.id);
  if (authIds.length) {
    for (const p of await must(db.from("people").select("id").in("auth_user_id", authIds), "linked people")) people.add(p.id);
  }
  const personIds = [...people];

  const venueIds = (await must(db.from("venues").select("id").like("name", `${TAG}%`), "find venues")).map((v: any) => v.id);
  const gatheringIds = new Set<string>(
    (await must(db.from("gatherings").select("id").like("name", `${TAG}%`), "find gatherings")).map((g: any) => g.id),
  );
  if (venueIds.length) {
    for (const g of await must(db.from("gatherings").select("id").in("venue_id", venueIds), "gatherings at seed venues")) {
      gatheringIds.add(g.id);
    }
  }
  const gIds = [...gatheringIds];

  await must(db.from("moderation_log").delete().eq("actor", ACTOR), "log by seed");
  if (gIds.length) await must(db.from("moderation_log").delete().in("gathering_id", gIds), "log on gatherings");
  if (personIds.length) await must(db.from("moderation_log").delete().in("person_id", personIds), "log on people");
  if (venueIds.length) await must(db.from("moderation_log").delete().in("venue_id", venueIds), "log on venues");

  if (personIds.length) {
    await must(db.from("reports").delete().in("reporter_id", personIds), "reports by");
    await must(db.from("reports").delete().in("target_person_id", personIds), "reports on");
  }
  // Cascades to pins, spot options, votes, group links, sources, triage.
  if (gIds.length) await must(db.from("gatherings").delete().in("id", gIds), "gatherings");
  if (personIds.length) await must(db.from("people").delete().in("id", personIds), "people");
  for (const id of venueIds) {
    const { data } = await db.storage.from("venue-maps").list(id);
    if (data?.length) await db.storage.from("venue-maps").remove(data.map((f) => `${id}/${f.name}`));
  }
  if (venueIds.length) {
    await must(db.from("meeting_spots").delete().in("venue_id", venueIds), "meeting spots");
    await must(db.from("venues").delete().in("id", venueIds), "venues"); // aliases, ids, suggestions cascade
  }
  for (const id of authIds) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) throw new Error(`delete user: ${error.message}`);
  }
  console.log(
    `Removed seed: ${gIds.length} gatherings, ${venueIds.length} venues, ${personIds.length} people, ${authIds.length} auth users.`,
  );
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

// "In N days at HH:MM Toronto time" as UTC.
function at(days: number, hhmm: string): string {
  const day = localDate(new Date(Date.now() + days * 86_400_000).toISOString(), TZ);
  const iso = fromLocalInput(`${day}T${hhmm}`, TZ);
  if (!iso) throw new Error(`bad time ${day} ${hhmm}`);
  return iso;
}

interface Draft {
  name: string;
  source: "ticketmaster" | "ai" | "manual";
  venue: "arena" | "stage" | "park" | null;
  raw?: string;
  days: number;
  time: string;
  ends?: [number, string];
  free?: boolean;
  score: number;
  reason: string;
}

const DRAFTS: Draft[] = [
  { name: "Maple Leafs vs Bruins", source: "ticketmaster", venue: "arena", days: 3, time: "19:00", score: 88, reason: "Rivalry game on a Saturday; many solo ticket buyers" },
  { name: "Raptors vs Knicks", source: "ticketmaster", venue: "arena", days: 6, time: "19:30", score: 82, reason: "Sold-out rivalry; strong fan-thread interest" },
  { name: "Blue Jays vs Yankees", source: "ticketmaster", venue: null, raw: "Rogers Centre", days: 4, time: "19:07", score: 79, reason: "Big crowd; venue not matched yet" },
  { name: "The Northern Lakes — Summer Tour", source: "ticketmaster", venue: "stage", days: 9, time: "19:30", score: 74, reason: "Arena-size concert, young crowd" },
  { name: "Lakeshore Jazz Night", source: "ticketmaster", venue: "stage", days: 12, time: "20:00", score: 55, reason: "Seated show; fewer people looking to meet" },
  { name: "Comedy Night Live", source: "ticketmaster", venue: "arena", days: 15, time: "20:00", score: 48, reason: "Seated; people come in pairs" },
  { name: "Trinity Bellwoods Flea", source: "ai", venue: "park", days: 5, time: "10:00", ends: [5, "16:00"], free: true, score: 71, reason: "Free market; lots of people browsing alone" },
  { name: "Saturday Run Club — 5k", source: "ai", venue: "park", days: 6, time: "08:30", free: true, score: 83, reason: "Social run club built around meeting people" },
  { name: "Harvest Festival Day", source: "ai", venue: "park", days: 13, time: "12:00", ends: [13, "18:00"], free: true, score: 77, reason: "Free festival day; all-day crowd" },
  { name: "The Northern Lakes — Summer Tour", source: "ai", venue: "stage", days: 9, time: "19:30", score: 70, reason: "Same show as a Ticketmaster listing (duplicate)" },
  { name: "Free Friday Club Night", source: "ai", venue: "stage", days: 8, time: "22:00", ends: [9, "02:00"], free: true, score: 66, reason: "Free entry club night; solo-friendly" },
  { name: "Street Food Festival", source: "ai", venue: "stage", days: 16, time: "13:00", score: 58, reason: "Paid entry; mostly families" },
  { name: "Leafs Watch Party", source: "manual", venue: "arena", days: 10, time: "19:00", score: 60, reason: "Away game on the big screen" },
  { name: "Board Game Social", source: "manual", venue: "stage", days: 11, time: "18:30", free: true, score: 52, reason: "Small, but designed for strangers" },
  { name: "Pride Trivia Night", source: "manual", venue: "arena", days: 17, time: "19:00", score: 45, reason: "Team trivia; fixed teams" },
];

type Photo = "approved" | "pending" | "rejected" | null;
const CAST: [string, "woman" | "man" | "nonbinary" | "undisclosed", Photo, boolean, number][] = [
  // name, gender, photo, open to meeting, party_total
  ["Ava", "woman", "approved", true, 1],
  ["Ben", "man", "approved", true, 1],
  ["Chloe", "woman", "pending", true, 1],
  ["Dev", "man", null, true, 2],
  ["Emma", "woman", "pending", true, 1],
  ["Farid", "man", "approved", true, 1],
  ["Grace", "woman", "pending", true, 1],
  ["Hiro", "man", null, true, 1],
  ["Isla", "nonbinary", "approved", true, 1],
  ["Jon", "man", "rejected", true, 1],
  ["Kira", "woman", "pending", true, 1],
  ["Leo", "man", null, true, 1], // reported ("uncomfortable") → auto-hidden
  ["Maya", "woman", "approved", true, 3],
  ["Nate", "man", null, false, 1],
  ["Olivia", "woman", null, false, 1],
  ["Priya", "woman", null, false, 1],
  ["Quinn", "undisclosed", null, false, 1],
  ["Raj", "man", null, false, 1],
  ["Sofia", "woman", null, false, 1],
  ["Tom", "man", null, false, 2],
];
const HOODS = ["liberty-village", "king-west", "leslieville", "the-annex", "roncesvalles", "junction", "midtown", null];

async function seed(db: SupabaseClient): Promise<void> {
  // Venues.
  const venue = async (key: string, name: string, address: string) =>
    [key, (await must(db.from("venues").insert({ name: `${TAG}${name}`, address }).select("id").single(), name)).id] as const;
  const venues = Object.fromEntries([
    await venue("arena", "Scotiabank Arena", "40 Bay St"),
    await venue("stage", "Budweiser Stage", "909 Lake Shore Blvd W"),
    await venue("park", "Trinity Bellwoods Park", "790 Queen St W"),
  ]) as Record<string, string>;

  const spots = (venueId: string, names: [string, string][]) =>
    names.map(([name, description], i) => ({ venue_id: venueId, name, description, sort_order: i }));
  await must(
    db.from("meeting_spots").insert([
      ...spots(venues.arena!, [
        ["North plaza screen", "Under the big screen on the north plaza"],
        ["Gate 1 steps", "The wide steps outside Gate 1"],
        ["Front Street patio", "The corner patio on Front Street"],
      ]),
      ...spots(venues.stage!, [
        ["Main gate flagpoles", "By the flagpoles at the main gate"],
        ["Lakeside boardwalk", "Where the boardwalk meets the path"],
        ["Box office", "In front of the box office windows"],
      ]),
    ]),
    "spots",
  );
  await must(
    db.from("spot_suggestions").insert([
      { venue_id: venues.park, name: "Main gates (Queen St)", description: "The iron gates on Queen St", reason: "Most-used entrance; easy to find" },
      { venue_id: venues.park, name: "Fountain by the dog bowl", description: "The fountain at the top of the bowl", reason: "Central landmark visible from paths" },
      { venue_id: venues.park, name: "Tennis court benches", description: "Benches along the tennis courts", reason: "Quiet, public, near washrooms" },
    ]),
    "spot suggestions",
  );
  await must(db.from("venue_aliases").insert({ venue_id: venues.arena, alias: "Scotiabank Centre" }), "alias");
  await must(
    db.from("venue_external_ids").insert({ venue_id: venues.arena, source: "ticketmaster", external_id: `${SEED}-venue-arena` }),
    "venue external id",
  );
  const mapPath = `${venues.arena}/map-seed.png`;
  await must(
    db.storage.from("venue-maps").upload(mapPath, png(480, 300, [236, 236, 236], [88, 40, 131]), { contentType: "image/png" }),
    "map",
  );
  await must(db.from("venues").update({ map_image_path: mapPath }).eq("id", venues.arena), "map path");

  // Drafts.
  let n = 0;
  for (const d of DRAFTS) {
    n++;
    const g = await must(
      db
        .from("gatherings")
        .insert({
          name: `${TAG}${d.name}`,
          starts_at: at(d.days, d.time),
          ends_at: d.ends ? at(d.ends[0], d.ends[1]) : null,
          venue_id: d.venue ? venues[d.venue] : null,
          venue_name_raw: d.raw ?? (d.venue ? null : "unknown"),
          source: d.source,
          is_free: d.free ?? false,
          event_url: d.source === "manual" ? null : `https://example.com/${SEED}/event-${n}`,
        })
        .select("id")
        .single(),
      d.name,
    );
    if (d.source !== "manual") {
      await must(
        db.from("gathering_sources").insert({
          gathering_id: g.id,
          source: d.source,
          external_id: `${SEED}-${d.source}-${n}`,
          urls: [`https://example.com/${SEED}/${d.source}-${n}`],
        }),
        `${d.name} source`,
      );
    }
    await must(db.from("gathering_triage").insert({ gathering_id: g.id, score: d.score, reason: d.reason }), `${d.name} triage`);
  }

  // The published gathering, with 20 fake pins.
  const pub = await must(
    db
      .from("gatherings")
      .insert({
        name: `${TAG}Maple Leafs vs Canadiens`,
        starts_at: at(4, "19:00"),
        venue_id: venues.arena,
        source: "ticketmaster",
        event_url: `https://example.com/${SEED}/leafs-habs`,
      })
      .select("id")
      .single(),
    "published gathering",
  );
  await must(
    db.from("gathering_sources").insert({ gathering_id: pub.id, source: "ticketmaster", external_id: `${SEED}-ticketmaster-pub`, urls: [`https://example.com/${SEED}/tm-pub`] }),
    "published source",
  );
  await must(db.from("gathering_triage").insert({ gathering_id: pub.id, score: 91, reason: "Original Six rivalry; the obvious pick" }), "published triage");
  await must(db.rpc("admin_publish_gathering", { p_gathering: pub.id, p_actor: ACTOR }), "publish");
  await must(
    db.from("gathering_group_links").insert([
      { gathering_id: pub.id, kind: "everyone", url: `https://chat.whatsapp.com/${SEED}TESTmain` },
      { gathering_id: pub.id, kind: "women_only", url: `https://chat.whatsapp.com/${SEED}TESTwomen` },
    ]),
    "group links",
  );

  const ids: Record<string, string> = {};
  let i = 0;
  for (const [name, gender, photo, open, party] of CAST) {
    const lower = name.toLowerCase();
    const user = await db.auth.admin.createUser({ email: `${SEED}-${lower}@example.com`, email_confirm: true });
    if (user.error || !user.data.user) throw new Error(`create user ${name}: ${user.error?.message}`);
    const authId = user.data.user.id;
    let photoPath: string | null = null;
    if (photo) {
      photoPath = `${authId}/photo.png`;
      const hue: [number, number, number] = [80 + ((i * 37) % 150), 90 + ((i * 53) % 120), 120 + ((i * 29) % 110)];
      await must(db.storage.from("photos").upload(photoPath, png(160, 160, hue, [40, 40, 40]), { contentType: "image/png" }), `photo ${name}`);
    }
    // Photo people without a handle half the time; everyone else has a handle (Q2).
    const handle = photo && i % 2 === 0 ? null : `${SEED}_${lower}`;
    const person = await must(
      db
        .from("people")
        .insert({
          auth_user_id: authId,
          first_name: name,
          instagram_handle: handle,
          neighbourhood: HOODS[i % HOODS.length],
          photo_path: photoPath,
          photo_status: photo ?? "pending",
        })
        .select("id")
        .single(),
      `person ${name}`,
    );
    ids[name] = person.id;
    await must(
      db.from("people_private").insert({ person_id: person.id, gender, birth_year: 1990 + (i % 10) }),
      `private ${name}`,
    );
    await must(
      db.from("pins").insert({ gathering_id: pub.id, person_id: person.id, open_to_meeting: open, party_total: party }),
      `pin ${name}`,
    );
    i++;
  }

  // One safety report: Ava reports Leo → Leo is auto-hidden, awaiting review (H9).
  await must(
    db.from("reports").insert({ reporter_id: ids.Ava, target_kind: "person", target_person_id: ids.Leo, reason: "uncomfortable" }),
    "report",
  );

  console.log(
    `Seeded: 3 venues (Trinity Bellwoods has 3 suggested spots pending, 0 approved), ${DRAFTS.length} drafts ` +
      `(one Ticketmaster + AI duplicate pair, 5 free, 1 unmatched venue), 1 published gathering with ${CAST.length} pins ` +
      `(4 photos pending, Leo auto-hidden by a report).`,
  );
}

const env = loadEnv(); // refuses anything but pind-staging
const db = newClient(env, env.secretKey);
await remove(db);
if (!process.argv.includes("--remove")) await seed(db);
