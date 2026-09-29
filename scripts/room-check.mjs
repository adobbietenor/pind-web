// The room, walked in real headless Chrome (M3.3) — before Alex and Tatiana walk it.
//
//   1  alone: A9 says "You're the first here…"
//   2  a second person opts in → notification #2 is written for the first (the promise)
//      → A9 shows the room → the room shows their arrival card and three openers
//   *  tapping an opener FILLS THE BOX and sends nothing (the database says 0 messages);
//      Send writes one (Alex: "never send anything for anyone")
//   3  a third → "enough to go together" → Go together → pick two who have posted →
//      the group page: "Just you so far — a group needs 3", and its deadline
//
//   npm run check:room
//
// A fresh seed gathering at the test crowd's venue (testers only, never public), three
// harness people made testers for the run (no photo check, never emailed), all deleted
// at the end.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal } from "../src/public/sealed.ts";
import { GROUP_COPY, ROOM_COPY, openersFor } from "../packages/shared/src/room.ts";

const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
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

const [crowd] = await must(await rest(`/rest/v1/gatherings?name=eq.${encodeURIComponent("Test crowd — walk the list")}&is_seed=eq.true&select=venue_id`), "test crowd");
const people = {};
let gathering = null;
let chrome;
let ok = true;
const step = (name, pass) => { console.log(`${pass ? "ok  " : "FAIL"} ${name}`); if (!pass) { ok = false; throw new Error(`stopped at: ${name}`); } };

async function person(label) {
  const email = `pind-roomcheck-${label.toLowerCase()}-${Date.now()}@example.com`;
  const password = randomUUID();
  const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), `user ${label}`);
  const [p] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: u.id, first_name: label, photo_path: `${u.id}/face.png` }) }), `person ${label}`);
  await must(await rest("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: p.id, gender: "man", birth_year: 1994 }) }), "private");
  await must(await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: p.id, source: "a26" }) }), "19+");
  await must(await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: u.id, p_on: true, p_actor: "room-check", p_note: "room-check" }) }), "tester");
  const t = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "sign in");
  people[label] = { authId: u.id, personId: p.id, refresh: t.refresh_token };
}
const optIn = async (label) => must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: gathering.id, person_id: people[label].personId, party_total: 1, open_to_meeting: true }) }), `opt in ${label}`);
const countMessages = async (label) => (await must(await rest(`/rest/v1/room_messages?author_id=eq.${people[label].personId}&select=id`), "count")).length;

try {
  [gathering] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: `Room check ${Date.now()}`, starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "gathering");
  const [{ slug }] = [await must(await rest("/rest/v1/rpc/admin_mint_slug", { method: "POST", body: JSON.stringify({ p_gathering: gathering.id }) }), "slug")].map((s) => ({ slug: s }));
  for (const n of ["Ari", "Bea", "Cal"]) await person(n);
  await optIn("Ari");

  const cookie = await seal(process.env.SESSION_SECRET, { userId: people.Ari.authId, refreshToken: people.Ari.refresh, issuedAt: Date.now() });
  const port = 9800 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-room-"))}`, "about:blank"], { stdio: "ignore" });
  let ws;
  for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0; const wait = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id)); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const body = () => evaluate("document.body.innerText").then(String);
  const until = async (text, ms = 20000) => { for (let t = 0; t < ms; t += 500) { if ((await body()).includes(text)) return true; await sleep(500); } return false; };
  const click = (text) => evaluate(`(() => { const els=[...document.querySelectorAll('[role=button],[role=checkbox],button,div,a')].filter(e=>e.innerText&&e.innerText.trim()===${JSON.stringify(text)}); const e=els[els.length-1]; if(!e) return false; e.click(); return true; })()`);
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1600, deviceScaleFactor: 2, mobile: true });
  await send("Network.setCookie", { name: "pind_pin", value: cookie, domain: new URL(SITE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });

  // 1 — alone.
  await send("Page.navigate", { url: `${SITE}/crowd/${slug}` });
  step("alone: 'You're the first here…'", await until(ROOM_COPY.firstLine));

  // 2 — a second arrives: the promise is a real notification.
  await optIn("Bea");
  const told = await must(await rest(`/rest/v1/notifications?person_id=eq.${people.Ari.personId}&kind=eq.room_open&select=body`), "notes");
  step("the first person's notification #2 exists, by name", told.length === 1 && /^Bea's going to /.test(told[0].body));
  await send("Page.reload");
  step("A9 shows the room", await until(ROOM_COPY.inRoom(2)));
  await click(ROOM_COPY.sayHi);
  step("the room shows Bea's arrival card", await until(`Bea ${ROOM_COPY.arrived}`));
  const openers = openersFor({ convening: "at_the_gathering", sharedTag: null });
  step("three openers are offered", (await body()).includes(openers[0]) && (await body()).includes(openers[1]));
  await click(openers[0]);
  await sleep(500);
  const boxed = await evaluate(`[...document.querySelectorAll('textarea,input')].map(x=>x.value).find(v=>v)`);
  step("tapping an opener fills the box", boxed === openers[0]);
  step("…and sends nothing", (await countMessages("Ari")) === 0);
  await click(ROOM_COPY.send);
  for (let t = 0; t < 20 && (await countMessages("Ari")) === 0; t++) await sleep(500);
  step("Send writes it", (await countMessages("Ari")) === 1);

  // 3 — a third: go together.
  await optIn("Cal");
  const roomId = (await must(await rest(`/rest/v1/room_members?person_id=eq.${people.Ari.personId}&gathering_id=eq.${gathering.id}&women_only=eq.false&select=room_id`), "room"))[0].room_id;
  for (const who of ["Bea", "Cal"]) await must(await rest("/rest/v1/room_messages", { method: "POST", body: JSON.stringify({ room_id: roomId, author_id: people[who].personId, body: `hi from ${who}` }) }), "say");
  await send("Page.reload");
  step("at 3: 'enough to go together'", await until(ROOM_COPY.enoughToGo));
  await click(ROOM_COPY.goTogether);
  await sleep(500);
  await click("Bea");
  await click("Cal");
  await click(GROUP_COPY.start);
  step("the group page: progress without attribution", await until(GROUP_COPY.soFar([])));
  step("…and its deadline", (await body()).includes("If there aren't 3 of you by"));
  ws.close();
} catch (err) {
  console.log(String(err.message ?? err));
  ok = false;
} finally {
  chrome?.kill();
  for (const p of Object.values(people)) {
    await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: p.authId, p_on: false, p_actor: "room-check" }) }).catch(() => undefined);
    await rest(`/rest/v1/people?auth_user_id=eq.${p.authId}`, { method: "DELETE" });
    await rest(`/auth/v1/admin/users/${p.authId}`, { method: "DELETE" });
  }
  if (gathering) await rest(`/rest/v1/gatherings?id=eq.${gathering.id}`, { method: "DELETE" });
}
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
