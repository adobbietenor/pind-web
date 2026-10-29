// How long a room message takes to reach the other people in the room (#13).
//
// Tatiana (14 Oct): "Messages can take several seconds to appear … I am only one person
// and it is already laggy, imagine with more." On that build every message reloaded the
// whole room before it showed. Since 16 Oct a message is one row: the sender sees it at
// once (it is drawn before the insert answers), and everyone else gets the row through
// Realtime. This measures the second half, the part the sender cannot see — with
// several listeners, because "with more" was the question.
//
//   npm run measure:room-latency            1 sender, 5 listeners, 8 messages
//   npm run measure:room-latency -- 10      1 sender, 10 listeners
//
// Harness people at a fresh gathering, all removed at the end (person with account).
// An instrument, not a check: it prints numbers and fails only if a message never arrives.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { needEnv } from "./fixture.mjs";

needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY");
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const service = createClient(base, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const LISTENERS = Number(process.argv[2] ?? 5);
const MESSAGES = 8;
// The room's own pace limit refuses a second message inside three seconds.
const GAP_MS = 3200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = async (q, what) => {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

const made = [];
let gathering = null;
const clients = [];
let failed = false;
try {
  const [venue] = await ok(service.from("venues").select("id").limit(1), "a venue");
  gathering = (
    await ok(
      service
        .from("gatherings")
        .insert({ name: `Latency ${Date.now()}`, starts_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), venue_id: venue.id, published_at: new Date().toISOString(), room_size: LISTENERS + 1 })
        .select("id")
        .single(),
      "gathering",
    )
  ).id;

  const people = [];
  for (let i = 0; i <= LISTENERS; i++) {
    const email = `latency-${Date.now()}-${i}@example.com`;
    const password = randomUUID();
    const u = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    if (u.error) throw new Error(`user: ${u.error.message}`);
    made.push(u.data.user.id);
    const person = await ok(service.from("people").insert({ auth_user_id: u.data.user.id, first_name: `L${i}`, photo_path: `${u.data.user.id}/face.png` }).select("id").single(), "person");
    await ok(service.from("people_private").insert({ person_id: person.id, gender: i % 2 ? "man" : "woman", birth_year: 1994 }), "private");
    await ok(service.from("age_attestations").upsert({ person_id: person.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }), "19+");
    const client = createClient(base, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`sign in: ${signIn.error.message}`);
    // Realtime checks RLS with the person's own token.
    client.realtime.setAuth(signIn.data.session.access_token);
    await ok(client.from("pins").insert({ gathering_id: gathering, person_id: person.id, party_total: 1, open_to_meeting: true }), "pin");
    clients.push(client);
    people.push({ personId: person.id, client });
  }
  const rooms = await ok(people[0].client.rpc("my_rooms", { p_gathering: gathering }), "my rooms");
  const room = rooms.find((r) => !r.women_only)?.room_id;
  if (!room) throw new Error("the sender was placed in no room");

  // Every listener subscribes the way the app does: INSERTs on this room, RLS-filtered.
  const arrivals = new Map(); // body -> [ms at each listener]
  const sentAt = new Map();
  await Promise.all(
    people.slice(1).map(
      (p, i) =>
        new Promise((resolve, reject) => {
          p.client
            .channel(`room:${room}:${i}`)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${room}` }, (payload) => {
              const at = performance.now();
              const body = payload.new?.body;
              if (!sentAt.has(body)) return;
              (arrivals.get(body) ?? arrivals.set(body, []).get(body)).push(at - sentAt.get(body));
            })
            .subscribe((status) => {
              if (status === "SUBSCRIBED") resolve();
              if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`listener ${i}: ${status}`));
            });
        }),
    ),
  );
  console.log(`${LISTENERS} listeners subscribed to one room; sending ${MESSAGES} messages, ${GAP_MS} ms apart`);

  const inserts = [];
  for (let m = 0; m < MESSAGES; m++) {
    const body = `latency ${m} ${randomUUID().slice(0, 6)}`;
    sentAt.set(body, performance.now());
    const t0 = performance.now();
    await ok(people[0].client.from("room_messages").insert({ room_id: room, author_id: people[0].personId, body }).select("id").single(), "send");
    inserts.push(performance.now() - t0);
    await sleep(GAP_MS);
  }
  await sleep(3000);

  const all = [...arrivals.values()].flat().sort((a, b) => a - b);
  const pct = (xs, p) => (xs.length ? Math.round(xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]) : NaN);
  const expected = MESSAGES * LISTENERS;
  console.log(`insert answered (what the sender waits on to see "sent"):   median ${pct(inserts.sort((a, b) => a - b), 50)} ms, worst ${Math.round(Math.max(...inserts))} ms`);
  console.log(`arrived at another person (send → their Realtime event):    median ${pct(all, 50)} ms, p90 ${pct(all, 90)} ms, worst ${Math.round(all.at(-1) ?? NaN)} ms`);
  console.log(`delivered ${all.length} of ${expected}`);
  // Which message went missing, and at how many listeners — a gap at the start is the
  // subscription still settling; one in the middle is a lost row.
  console.log(`per message, in order: ${[...sentAt.keys()].map((b) => arrivals.get(b)?.length ?? 0).join(" ")}`);
  if (all.length < expected) failed = true;
} catch (err) {
  console.error(String(err.message ?? err));
  failed = true;
} finally {
  for (const c of clients) await c.removeAllChannels().catch(() => undefined);
  if (gathering) await service.from("gatherings").delete().eq("id", gathering);
  for (const id of made) {
    await service.from("people").delete().eq("auth_user_id", id);
    await service.auth.admin.deleteUser(id);
  }
}
process.exit(failed ? 1 : 0);
