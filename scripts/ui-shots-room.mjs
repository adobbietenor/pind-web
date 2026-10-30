// Screenshots of the opted-in screens (A9 open, A10 the room, A19 My Events) as a real
// signed-in tester, for UI pass 1's comparisons with its mockups (055, 057, 107). Not a
// pass/fail check. It makes its own gathering at the test crowd's venue (testers only),
// four harness people who opt in, a short conversation, then shoots and removes it all.
//
//   node --env-file=.dev.vars scripts/ui-shots-room.mjs <out-dir> [count=4]
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { needChrome, needEnv, testCrowd } from "./fixture.mjs";

needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY");
const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
needChrome(CHROME);
const out = process.argv[2];
if (!out) throw new Error("usage: ui-shots-room.mjs <out-dir> [count]");
mkdirSync(out, { recursive: true });
const COUNT = Number(process.argv[3] || 4);
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const ref = new URL(base).hostname.split(".")[0];
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
const S = { apikey: service, authorization: `Bearer ${service}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rest = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...S, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
const must = async (res, what) => {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const NAMES = ["Ari", "Priya", "Dev", "Sam", "Maya", "Jon", "Lee", "Kit"].slice(0, COUNT);
const HOODS = ["leslieville", "the-annex", "junction", "parkdale"];
const TAGS = ["chatty", "live-music", "comedy"];

const crowd = await testCrowd({ pinnable: false });
const people = {};
let gathering = null;
let chrome;

async function person(label, i) {
  const email = `pind-uishots-${label.toLowerCase()}-${Date.now()}@example.com`;
  const password = randomUUID();
  const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), `user ${label}`);
  const photo = `${u.id}/face-${Date.now()}.png`;
  await must(await fetch(`${base}/storage/v1/object/photos/${photo}`, { method: "POST", headers: { ...S, "content-type": "image/png" }, body: PNG }), `photo ${label}`);
  const [p] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: u.id, first_name: label, photo_path: photo, neighbourhood: HOODS[i % HOODS.length] }) }), `person ${label}`);
  await must(await rest("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: p.id, gender: i % 2 ? "woman" : "man", birth_year: 1994 }) }), "private");
  await must(await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: p.id, source: "a26" }) }), "19+");
  await rest("/rest/v1/person_tags", { method: "POST", body: JSON.stringify(TAGS.map((tag) => ({ person_id: p.id, tag }))) });
  await must(await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: u.id, p_on: true, p_actor: "ui-shots", p_note: "ui-shots" }) }), "tester");
  const session = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "sign in");
  people[label] = { authId: u.id, personId: p.id, photo, session };
}
const says = async (label, roomId, body) => (await sleep(3200), true) &&
  must(await fetch(`${base}/rest/v1/room_messages`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${people[label].session.access_token}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify({ room_id: roomId, author_id: people[label].personId, body }) }), `${label} says`);

try {
  [gathering] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: "Leafs vs Bruins (UI shots)", starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "gathering");
  await must(await rest("/rest/v1/rpc/admin_mint_slug", { method: "POST", body: JSON.stringify({ p_gathering: gathering.id }) }), "slug");
  const [g] = await must(await rest(`/rest/v1/gatherings?id=eq.${gathering.id}&select=slug`), "the slug");
  for (const [i, n] of NAMES.entries()) await person(n, i);
  for (const n of NAMES) await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: gathering.id, person_id: people[n].personId, party_total: 1, open_to_meeting: true }) }), `opt in ${n}`);
  const roomId = (await must(await rest(`/rest/v1/room_members?person_id=eq.${people.Ari.personId}&gathering_id=eq.${gathering.id}&women_only=eq.false&select=room_id`), "room"))[0]?.room_id;
  if (!roomId) throw new Error("Ari was not placed in a room");
  if (NAMES.includes("Priya")) await says("Priya", roomId, "Anyone grabbing food before puck drop?");
  if (NAMES.includes("Dev")) await says("Dev", roomId, "I'm in. Getting there around 5:30.");
  await says("Ari", roomId, "Same, first time going solo. Count me in!");
  if (NAMES.includes("Priya")) await says("Priya", roomId, "Love it, see you there.");

  const port = 9700 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-uishots-"))}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let ws;
  for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0; const wait = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id)); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const body = () => evaluate("document.body.innerText").then(String);
  const until = async (text, ms = 20000) => { for (let t = 0; t < ms; t += 500) { if ((await body()).includes(text)) return true; await sleep(500); } return false; };
  const snap = async (name, full = true) => {
    await sleep(1500);
    if (full) {
      const h = await evaluate("document.documentElement.scrollHeight");
      await send("Emulation.setDeviceMetricsOverride", { width: 393, height: Math.min(Math.max(h, 852), 4000), deviceScaleFactor: 2, mobile: true });
      await sleep(500);
    }
    writeFileSync(join(out, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
    console.log(`== ${name}\n${(await body()).slice(0, 700)}\n`);
    await send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: `${SITE}/` });
  await sleep(1500);
  await evaluate(`localStorage.setItem(${JSON.stringify(`sb-${ref}-auth-token`)}, ${JSON.stringify(JSON.stringify(people.Ari.session))}); true`);

  await send("Page.navigate", { url: `${SITE}/crowd/${g.slug}` });
  await until("Open to meeting");
  await snap("a9-open");
  await send("Page.navigate", { url: `${SITE}/room/${roomId}` });
  await until("Love it, see you there.") || await until(NAMES[1]);
  await snap("a10-room", false);
  await send("Page.navigate", { url: `${SITE}/my-events` });
  await until("My Events");
  await snap("a19");
  ws.close();
} catch (err) {
  console.log(String(err.stack ?? err));
  process.exitCode = 1;
} finally {
  chrome?.kill();
  for (const p of Object.values(people)) {
    await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: p.authId, p_on: false, p_actor: "ui-shots" }) }).catch(() => undefined);
    await rest(`/rest/v1/people?auth_user_id=eq.${p.authId}`, { method: "DELETE" });
    await fetch(`${base}/storage/v1/object/photos/${p.photo}`, { method: "DELETE", headers: S }).catch(() => undefined);
    await rest(`/auth/v1/admin/users/${p.authId}`, { method: "DELETE" });
  }
  if (gathering) await rest(`/rest/v1/gatherings?id=eq.${gathering.id}`, { method: "DELETE" });
}
