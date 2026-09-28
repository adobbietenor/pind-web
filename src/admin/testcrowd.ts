// The test crowd — people to walk a list with, visible only to testers (M3.2).
//
// Alex's walk needs a page worth looking at: several people, some open to meeting and
// some pinned without, faces and no faces, a mix of tags. Real people cannot be made
// up (H6), so these are **seed people at one seed gathering** — invisible to everyone
// but the testers list (V18 and its testers exception, P92–P99), never on a public
// page, never in a count anyone else sees.
//
// **Their photos are illustrations**, drawn here as flat shapes and rasterised with the
// OG image's renderer — visibly not photographs, so nobody mistakes a test person for
// a real one on a screen being judged (Alex). They are written `approved` (one
// `rejected`, so the list shows what that looks like), and the photo check only ever
// looks at `pending`, so no model ever sees them.
//
// Refreshing deletes every person this built (marked `pind_test_crowd` on the auth
// user) and builds them again.

// Imported by file, with extensions, so `scripts/test-crowd.ts` can run this same code
// under node with node’s renderer (the Worker passes its own).
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_TAGS } from "../../packages/shared/src/tags.ts";

export type Render = (svg: string) => Uint8Array;

export const TEST_CROWD_VENUE = "Test Crowd Venue (staging — testers only)";
export const TEST_CROWD_NAME = "Test crowd — walk the list";

type Gender = "woman" | "man" | "nonbinary" | "undisclosed";
interface Persona {
  first: string;
  gender: Gender;
  hood: string | null;
  open: boolean;
  photo: "approved" | "rejected" | null;
  party: number;
  tags: number[]; // indexes into ALL_TAGS; the first three are on the list
  look: { bg: string; skin: string; hair: string; style: 0 | 1 | 2 };
}

const CROWD: Persona[] = [
  { first: "Maya", gender: "woman", hood: "king-west", open: true, photo: "approved", party: 1, tags: [0, 12, 20, 25], look: { bg: "#7a4fb0", skin: "#e8b89a", hair: "#2b1d16", style: 0 } },
  { first: "Theo", gender: "man", hood: "leslieville", open: true, photo: "approved", party: 2, tags: [3, 14, 22], look: { bg: "#2f6f8f", skin: "#c68a64", hair: "#1a1a1a", style: 1 } },
  { first: "Priya", gender: "woman", hood: "the-annex", open: true, photo: "approved", party: 1, tags: [6, 9, 18, 27, 30], look: { bg: "#b0503f", skin: "#9c6a48", hair: "#120c0a", style: 2 } },
  { first: "Sam", gender: "nonbinary", hood: "kensington-market", open: true, photo: "approved", party: 1, tags: [1, 16, 24], look: { bg: "#3f7f55", skin: "#f1c7a8", hair: "#c98a3b", style: 1 } },
  { first: "Jordan", gender: "man", hood: null, open: true, photo: "rejected", party: 3, tags: [5, 11, 21], look: { bg: "#555", skin: "#ddd", hair: "#999", style: 0 } },
  { first: "Ada", gender: "woman", hood: "junction", open: false, photo: "approved", party: 1, tags: [2, 15, 23], look: { bg: "#8f6f2f", skin: "#e0a98a", hair: "#5a2d1a", style: 2 } },
  { first: "Lee", gender: "undisclosed", hood: "queen-west", open: false, photo: null, party: 2, tags: [4, 19], look: { bg: "#444", skin: "#ccc", hair: "#777", style: 1 } },
  { first: "Ren", gender: "man", hood: null, open: false, photo: null, party: 1, tags: [], look: { bg: "#444", skin: "#ccc", hair: "#777", style: 0 } },
];

// A flat, cartoon portrait — circles and a hair shape. Deliberately not a face anyone
// could take for a photograph.
export function portraitSvg(look: Persona["look"]): string {
  const hair = [
    `<path d="M88 118c0-40 26-64 62-64s62 24 62 64c-10-22-34-30-62-30s-52 8-62 30z" fill="${look.hair}"/>`,
    `<path d="M92 112c4-34 28-54 58-54s54 20 58 54c-18-10-38-14-58-14s-40 4-58 14z" fill="${look.hair}"/>`,
    `<path d="M84 124c-2-46 26-72 66-72s68 26 66 72v70h-20v-66c-12-14-28-20-46-20s-34 6-46 20v66H84z" fill="${look.hair}"/>`,
  ][look.style];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
<rect width="300" height="300" fill="${look.bg}"/>
<path d="M60 300c6-56 44-86 90-86s84 30 90 86z" fill="#f4f1ea" opacity=".92"/>
<circle cx="150" cy="138" r="58" fill="${look.skin}"/>
${hair}
<circle cx="128" cy="140" r="6" fill="#1b1b1b"/><circle cx="172" cy="140" r="6" fill="#1b1b1b"/>
<path d="M128 166q22 16 44 0" stroke="#1b1b1b" stroke-width="5" fill="none" stroke-linecap="round"/>
</svg>`;
}

async function must<T>(q: PromiseLike<{ data: T; error: { message?: string } | null }>, what: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message ?? "failed"}`);
  return data;
}

export async function testCrowdStatus(db: SupabaseClient): Promise<{ slug: string | null; people: number }> {
  const { data: g } = await db.from("gatherings").select("id, slug").eq("name", TEST_CROWD_NAME).eq("is_seed", true).maybeSingle();
  if (!g) return { slug: null, people: 0 };
  const { count } = await db.from("pins").select("id", { count: "exact", head: true }).eq("gathering_id", g.id);
  return { slug: g.slug, people: count ?? 0 };
}

export async function buildTestCrowd(db: SupabaseClient, render: Render): Promise<{ slug: string; people: number }> {
  // The seed venue — its flag carries to the gathering (P57), so it can never be public.
  let venue = (await db.from("venues").select("id").eq("name", TEST_CROWD_VENUE).maybeSingle()).data as { id: string } | null;
  if (!venue) {
    venue = (await must(
      db.from("venues").insert({ name: TEST_CROWD_VENUE, address: "1 Test Street, Toronto", is_seed: true }).select("id").single(),
      "seed venue",
    )) as { id: string };
    await must(db.from("meeting_spots").insert({ venue_id: venue.id, name: "The front steps" }), "seed spot");
  }

  // The gathering, three days out at 7pm, published, with a slug the app can open.
  let g = (await db.from("gatherings").select("id, slug").eq("name", TEST_CROWD_NAME).eq("is_seed", true).maybeSingle()).data as
    | { id: string; slug: string | null }
    | null;
  if (!g) {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 3);
    start.setUTCHours(23, 0, 0, 0); // 7pm Toronto
    g = (await must(
      db
        .from("gatherings")
        .insert({ name: TEST_CROWD_NAME, starts_at: start.toISOString(), venue_id: venue!.id, published_at: new Date().toISOString() })
        .select("id, slug")
        .single(),
      "seed gathering",
    )) as { id: string; slug: string | null };
  }
  if (!g.slug) g.slug = (await must(db.rpc("admin_mint_slug", { p_gathering: g.id }), "slug")) as string;

  // Refresh: every person this built before goes, auth user and all.
  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of users?.users ?? []) {
    if (u.app_metadata?.pind_test_crowd === true) {
      await db.from("people").delete().eq("auth_user_id", u.id);
      await db.auth.admin.deleteUser(u.id);
    }
  }

  for (const p of CROWD) {
    const made = await db.auth.admin.createUser({
      email: `test-crowd-${p.first.toLowerCase()}-${Date.now()}@example.com`,
      email_confirm: true,
      password: crypto.randomUUID(),
      app_metadata: { pind_test_crowd: true },
    });
    if (made.error || !made.data.user) throw new Error(`user ${p.first}: ${made.error?.message}`);
    const authId = made.data.user.id;

    let photoPath: string | null = null;
    if (p.photo) {
      photoPath = `${authId}/portrait.png`;
      await must(
        db.storage.from("photos").upload(photoPath, render(portraitSvg(p.look)), { contentType: "image/png", upsert: true }),
        `portrait ${p.first}`,
      );
    }
    const person = (await must(
      db
        .from("people")
        .insert({
          auth_user_id: authId,
          first_name: p.first,
          neighbourhood: p.hood,
          photo_path: photoPath,
          // Never `pending`: the check only ever looks at pending, so no model sees these.
          photo_status: p.photo ?? "pending",
          is_seed: true,
        })
        .select("id")
        .single(),
      `person ${p.first}`,
    )) as { id: string };
    await must(db.from("people_private").insert({ person_id: person.id, gender: p.gender, birth_year: 1994 }), `private ${p.first}`);
    await db.from("age_attestations").upsert({ person_id: person.id, source: "a2" }, { onConflict: "person_id", ignoreDuplicates: true });
    if (p.tags.length) {
      await must(
        db.from("person_tags").insert(p.tags.map((i, n) => ({ person_id: person.id, tag: ALL_TAGS[i % ALL_TAGS.length]!.slug, on_list: n < 3 }))),
        `tags ${p.first}`,
      );
    }
    await must(
      db.from("pins").insert({ gathering_id: g.id, person_id: person.id, party_total: p.party, open_to_meeting: p.open }),
      `pin ${p.first}`,
    );
  }
  return { slug: g.slug!, people: CROWD.length };
}
