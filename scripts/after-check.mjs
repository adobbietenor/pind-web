// After the night, walked in real headless Chrome (M3.3) — before Alex walks it.
//
//   A16  "We met" → the database has the tick, the screen says only you know → Bea ticks
//        back → "You met" and "Keep in touch" → both ways → a connection; the question,
//        answered once
//   A20  Bea is in Connections, "Met at …"; Invite lists what Ari is pinned to; Invite
//        sends #7 to Bea
//   A17  the finished group points at A16
//
//   npm run check:after
//
// A fresh gathering at the test crowd's venue (testers only), moved into the past so its
// group finishes; a second one ahead for the invite. Three harness people made testers
// for the run (never emailed), all deleted at the end.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal } from "../src/public/sealed.ts";
import { AFTER_COPY, CONNECTIONS_COPY } from "../packages/shared/src/after.ts";
import { needChrome, needEnv, sessionSecretMatches, testCrowd } from "./fixture.mjs";

// Fixtures first: a check whose ground moved says so in a sentence (scripts/fixture.mjs).
needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SESSION_SECRET");

const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
needChrome(CHROME);
await sessionSecretMatches(SITE);
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
// As the person, through RLS — the way the app calls it.
const as = (label, fn, body) =>
  fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${people[label].access}`, "content-type": "application/json" }, body: JSON.stringify(body) });

const crowd = await testCrowd({ pinnable: false });
const people = {};
const made = [];
let chrome;
let ok = true;
let crew = null;
const step = (name, pass) => { console.log(`${pass ? "ok  " : "FAIL"} ${name}`); if (!pass) { ok = false; throw new Error(`stopped at: ${name}`); } };

async function person(label) {
  const email = `pind-aftercheck-${label.toLowerCase()}-${Date.now()}@example.com`;
  const password = randomUUID();
  const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), `user ${label}`);
  const [p] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: u.id, first_name: label, photo_path: `${u.id}/face.png` }) }), `person ${label}`);
  await must(await rest("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: p.id, gender: "man", birth_year: 1994 }) }), "private");
  await must(await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: p.id, source: "a26" }) }), "19+");
  await must(await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: u.id, p_on: true, p_actor: "after-check", p_note: "after-check" }) }), "tester");
  const t = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "sign in");
  people[label] = { authId: u.id, personId: p.id, refresh: t.refresh_token, access: t.access_token };
}
const gathering = async (name, startsAt) =>
  (await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name, starts_at: startsAt, venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "gathering"))[0];

try {
  const X = await gathering(`After check ${Date.now()}`, new Date(Date.now() + 3 * 86_400_000).toISOString());
  made.push(X.id);
  const slug = await must(await rest("/rest/v1/rpc/admin_mint_slug", { method: "POST", body: JSON.stringify({ p_gathering: X.id }) }), "slug");
  const Y = await gathering(`After check next ${Date.now()}`, new Date(Date.now() + 5 * 86_400_000).toISOString());
  made.push(Y.id);
  for (const n of ["Ari", "Bea", "Cal"]) {
    await person(n);
    await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: X.id, person_id: people[n].personId, party_total: 1, open_to_meeting: true }) }), `pin ${n}`);
  }
  const roomId = (await must(await rest(`/rest/v1/room_members?person_id=eq.${people.Ari.personId}&gathering_id=eq.${X.id}&women_only=eq.false&select=room_id`), "room"))[0].room_id;
  for (const n of ["Ari", "Bea", "Cal"]) await must(await rest("/rest/v1/room_messages", { method: "POST", body: JSON.stringify({ room_id: roomId, author_id: people[n].personId, body: `hi from ${n}` }) }), "say");
  crew = await must(await as("Ari", "start_group", { p_room: roomId, p_invitees: [people.Bea.personId, people.Cal.personId] }), "start");
  for (const n of ["Bea", "Cal"]) {
    const [inv] = await must(await as(n, "my_invites", { p_gathering: X.id }), "invites");
    await must(await as(n, "respond_to_invite", { p_invite: inv.invite_id, p_accept: true }), "accept");
  }
  // The night happens: two days ago, then the lifecycle job finishes the group.
  const past = new Date(Date.now() - 2 * 86_400_000);
  past.setUTCHours(23, 0, 0, 0);
  await must(await rest(`/rest/v1/gatherings?id=eq.${X.id}`, { method: "PATCH", body: JSON.stringify({ starts_at: past.toISOString() }) }), "the night");
  await must(await rest("/rest/v1/rpc/admin_groups_tick", { method: "POST", body: "{}" }), "tick");
  const [{ state }] = await must(await rest(`/rest/v1/crews?id=eq.${crew}&select=state`), "state");
  step("the group is done after the night", state === "done");
  await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: Y.id, person_id: people.Ari.personId, party_total: 1 }) }), "Ari pins the next one");

  const cookie = await seal(process.env.SESSION_SECRET, { userId: people.Ari.authId, refreshToken: people.Ari.refresh, issuedAt: Date.now() });
  const port = 9600 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-after-"))}`, "about:blank"], { stdio: "ignore" });
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
  const count = async (path) => (await must(await rest(path), path)).length;
  const poll = async (path, want) => { for (let t = 0; t < 20; t++) { if ((await count(path)) >= want) return true; await sleep(500); } return false; };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1600, deviceScaleFactor: 2, mobile: true });
  await send("Network.setCookie", { name: "pind_pin", value: cookie, domain: new URL(SITE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });

  // A17 — the finished group points at A16.
  await send("Page.navigate", { url: `${SITE}/group/${crew}` });
  step("A17: the group says it has finished", await until(AFTER_COPY.finished));
  await click(AFTER_COPY.howDidItGo);
  step("…and its one action opens A16", await until(AFTER_COPY.whoDidYouMeet));

  // A16 — the ticks.
  step("A16 asks the question too", (await body()).includes(AFTER_COPY.question));
  await click(AFTER_COPY.weMet);
  step("'We met' writes the tick", await poll(`/rest/v1/confirmations?crew_id=eq.${crew}&from_person=eq.${people.Ari.personId}&select=kind`, 1));
  step("…and says only Ari knows", await until(AFTER_COPY.ticked));
  const tickedWho = (await must(await rest(`/rest/v1/confirmations?crew_id=eq.${crew}&from_person=eq.${people.Ari.personId}&select=to_person`), "who"))[0].to_person;
  const other = tickedWho === people.Bea.personId ? "Bea" : "Cal";
  await must(await as(other, "after_tick", { p_crew: crew, p_to: people.Ari.personId, p_kind: "we_met", p_on: true }), "tick back");
  await send("Page.reload");
  step(`${other} ticks back: 'You met'`, await until(AFTER_COPY.matched));
  await click(AFTER_COPY.keepInTouch);
  step("'Keep in touch' writes the ask", await poll(`/rest/v1/confirmations?crew_id=eq.${crew}&from_person=eq.${people.Ari.personId}&kind=eq.keep_in_touch&select=kind`, 1));
  await must(await as(other, "after_tick", { p_crew: crew, p_to: people.Ari.personId, p_kind: "keep_in_touch", p_on: true }), "keep back");
  await send("Page.reload");
  step("both ways: connected", await until(AFTER_COPY.connected));

  // The question.
  await click("No");
  step("the answer is written once", await poll(`/rest/v1/survey_responses?gathering_id=eq.${X.id}&person_id=eq.${people.Ari.personId}&select=id`, 1));
  step("…and thanked", await until(AFTER_COPY.thanks));

  // A20 — Connections and invite.
  await send("Page.navigate", { url: `${SITE}/connections` });
  step(`A20 lists ${other}, where they met`, await until(CONNECTIONS_COPY.metAt(X.name)));
  await click(CONNECTIONS_COPY.invite);
  step("Invite lists what Ari is pinned to", await until(Y.name));
  await click(CONNECTIONS_COPY.invite);
  step("#7 reaches the connection", await poll(`/rest/v1/notifications?person_id=eq.${people[other].personId}&kind=eq.invite&select=id`, 1));
  step("…and the screen says so", await until(CONNECTIONS_COPY.sent(other)));
  ws.close();
} catch (err) {
  console.log(String(err.message ?? err));
  ok = false;
} finally {
  chrome?.kill();
  if (crew) await rest(`/rest/v1/confirmations?crew_id=eq.${crew}`, { method: "DELETE" });
  for (const p of Object.values(people)) {
    await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: p.authId, p_on: false, p_actor: "after-check" }) });
    await rest(`/rest/v1/people?auth_user_id=eq.${p.authId}`, { method: "DELETE" });
    await rest(`/auth/v1/admin/users/${p.authId}`, { method: "DELETE" });
  }
  for (const g of made) {
    await rest(`/rest/v1/crews?gathering_id=eq.${g}`, { method: "DELETE" });
    await rest(`/rest/v1/gatherings?id=eq.${g}`, { method: "DELETE" });
  }
}
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
