// 1-on-1, walked end to end in two real headless Chromes, one per person, each signed in as
// themselves (A9, A28, A29, A20, A22; build 23, Alex 16 Nov 2026).
//
//   Ari (signed in through the sealed hand-off, as the app is) opens the crowd page: the
//   question "Open to meeting people 1-on-1 at this event?" is there, and with it off she sees
//   only "Turn this on to see who's open to 1-on-1" — nobody (H3). She turns it on: "Open to
//   1-on-1 here" lists Bea. She taps Bea and sends "Request to chat": "Request sent".
//   Bea, in her own browser, sees it on the event's crowd page and in Connections → Requests
//   (and was sent #8). She accepts in Connections: her chat opens, with nothing asked about a
//   place or a time; Ari is told (#3). They write to each other and each reads the other.
//   Ari finds Bea in Connections, taps her: her profile, with "Message", opens the same chat.
//   Cal's request, answered "Not now", leaves Bea's Requests and still reads as sent to Cal.
//   Ari calls off the 1-on-1: the chat and the connection end for both, silently.
//
//   npm run check:pair
//
// Fixtures first (scripts/fixture.mjs). The test crowd's venue is used for its city only: a
// 1-on-1 no longer needs meeting spots. Every person is a harness user, removed at the end
// with their account.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal } from "../src/public/sealed.ts";
import { ONE_ON_ONE_COPY, SOLO_COPY } from "../packages/shared/src/solo.ts";
import { THREAD_COPY } from "../packages/shared/src/thread.ts";
import { needChrome, needEnv, sessionSecretMatches, testCrowd } from "./fixture.mjs";

needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SESSION_SECRET");

const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
needChrome(CHROME);
await sessionSecretMatches(SITE);
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
const S = { apikey: service, authorization: `Bearer ${service}` };
const ref = new URL(base).hostname.split(".")[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rest = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...S, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
const must = async (res, what) => {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};

const crowd = await testCrowd({ pinnable: false });

const people = {};
const extra = [];
const chromes = [];
let gathering = null;
let ok = true;
const step = (name, pass) => { console.log(`${pass ? "ok  " : "FAIL"} ${name}`); if (!pass) { ok = false; throw new Error(`stopped at: ${name}`); } };

async function person(label, gender) {
  const email = `pind-paircheck-${label.toLowerCase()}-${Date.now()}@example.com`;
  const password = randomUUID();
  const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), `user ${label}`);
  const [p] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: u.id, first_name: label, photo_path: `${u.id}/face.png` }) }), `person ${label}`);
  await must(await rest("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: p.id, gender, birth_year: 1994 }) }), "private");
  await must(await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: p.id, source: "a26" }) }), "19+");
  await must(await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: u.id, p_on: true, p_actor: "pair-check", p_note: "pair-check" }) }), "tester");
  const t = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "sign in");
  people[label] = { authId: u.id, personId: p.id, refresh: t.refresh_token, access: t.access_token, session: t };
}
// As the person themselves, with their own token — never the service key for a product act.
const as = (label, fn, args) =>
  fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${people[label].access}`, "content-type": "application/json" }, body: JSON.stringify(args) });

// One person's own browser: its own Chrome, profile and session.
async function browser() {
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-pair-"))}`, "about:blank"], { stdio: "ignore" });
  chromes.push(proc);
  let ws;
  for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0; const wait = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id)); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const body = () => evaluate("document.body.innerText").then(String);
  const until = async (text, ms = 20000) => { for (let t = 0; t < ms; t += 500) { if ((await body()).includes(text)) return true; await sleep(500); } return false; };
  const click = (text) => evaluate(`(() => { const els=[...document.querySelectorAll('[role=button],[role=radio],button,div,a')].filter(e=>e.innerText&&e.innerText.trim()===${JSON.stringify(text)}); const e=els[els.length-1]; if(!e) return false; e.click(); return true; })()`);
  const path = () => evaluate("location.pathname").then(String);
  const go = (url) => send("Page.navigate", { url });
  const type = async (placeholder, text) => {
    const focused = await evaluate(`(() => { const i=[...document.querySelectorAll('textarea,input')].find(x=>x.placeholder===${JSON.stringify(placeholder)}); i && i.focus(); return !!i; })()`);
    if (focused) await send("Input.insertText", { text });
    return focused;
  };
  const sendMessage = () => evaluate(`(() => { const b=[...document.querySelectorAll('[aria-label=${JSON.stringify(THREAD_COPY.send)}]')].pop(); if(!b) return false; b.click(); return true; })()`);
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1800, deviceScaleFactor: 2, mobile: true });
  return { send, evaluate, body, until, click, path, go, type, sendMessage, close: () => ws.close() };
}

try {
  [gathering] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: `Pair check ${Date.now()}`, starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "gathering");
  const slug = await must(await rest("/rest/v1/rpc/admin_mint_slug", { method: "POST", body: JSON.stringify({ p_gathering: gathering.id }) }), "slug");
  await person("Ari", "woman");
  await person("Bea", "woman");
  for (const n of ["Ari", "Bea"]) {
    await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: gathering.id, person_id: people[n].personId, party_total: 1, open_to_meeting: true }) }), `pin ${n}`);
  }
  // Bea's switch as herself; Ari's on the crowd page below.
  await must(await as("Bea", "set_event_one_on_one", { p_gathering: gathering.id, p_on: true, p_audience: "everyone" }), "Bea 1-on-1 on here");

  // Ari's browser: the sealed hand-off, as the quick pin leaves it.
  const ari = await browser();
  const cookie = await seal(process.env.SESSION_SECRET, { userId: people.Ari.authId, refreshToken: people.Ari.refresh, issuedAt: Date.now() });
  await ari.send("Network.setCookie", { name: "pind_pin", value: cookie, domain: new URL(SITE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
  // Bea's browser: her own session, in her own profile.
  const bea = await browser();
  await bea.go(`${SITE}/privacy`);
  await sleep(1500);
  await bea.evaluate(`(() => { localStorage.setItem(${JSON.stringify(`sb-${ref}-auth-token`)}, ${JSON.stringify(JSON.stringify(people.Bea.session))}); return true; })()`);

  // A9: the question, and with it off, nobody (H3).
  await ari.go(`${SITE}/crowd/${slug}`);
  step("A9 asks 'Open to meeting people 1-on-1 at this event?'", await ari.until(ONE_ON_ONE_COPY.switchLabel, 25000));
  step("…off to begin with: one line, and no list", (await ari.until(ONE_ON_ONE_COPY.offLine)) && !(await ari.body()).includes(ONE_ON_ONE_COPY.sectionHeading));
  await ari.evaluate(`(() => { const s=[...document.querySelectorAll('[role=switch]')].find(e=>e.innerText.includes(${JSON.stringify(ONE_ON_ONE_COPY.switchLabel)})); if(!s) return false; s.click(); return true; })()`);
  let on = null;
  for (let t = 0; t < 20 && on === null; t++) { await sleep(500); on = await must(await as("Ari", "my_solo", { p_gathering: gathering.id }), "Ari's switch"); }
  step("turning it on switches Ari on for this event", on === "everyone");
  step("'Open to 1-on-1 here' appears", await ari.until(ONE_ON_ONE_COPY.sectionHeading, 25000));
  const tapped = await ari.evaluate(`(() => {
    const h=[...document.querySelectorAll('div')].find(e=>e.innerText===${JSON.stringify(ONE_ON_ONE_COPY.sectionHeading)});
    if(!h) return "no heading";
    const rows=[...document.querySelectorAll('[role=button]')].filter(r=>r.innerText.includes("Bea") && (h.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING));
    if(!rows.length) return "no Bea"; rows[0].click(); return "ok"; })()`);
  step("…with Bea in it; tapping her opens her sheet with 'Request to chat'", tapped === "ok" && (await ari.until(ONE_ON_ONE_COPY.ask)));
  await ari.click(ONE_ON_ONE_COPY.ask);
  step("one tap: 'Request sent'", await ari.until(ONE_ON_ONE_COPY.sent("Bea")));
  const [inv] = await must(await rest(`/rest/v1/solo_proposals?gathering_id=eq.${gathering.id}&from_person=eq.${people.Ari.personId}&select=id,spot_id,meet_at,status`), "the request");
  step("…a request with no place and no time", inv && inv.spot_id === null && inv.meet_at === null && inv.status === "open");
  const push = await must(await rest(`/rest/v1/notifications?person_id=eq.${people.Bea.personId}&kind=eq.solo_proposal&select=body`), "Bea's #8");
  step("Bea is sent the request (#8, push or its email)", push.some((x) => x.body.includes(ONE_ON_ONE_COPY.wantsToMeet("Ari").replace(" 1-on-1", ""))));

  // Bea, in her own browser: on the event's page, and in Connections → Requests.
  await bea.go(`${SITE}/crowd/${slug}`);
  step("Bea sees it on the event's crowd page", (await bea.until(ONE_ON_ONE_COPY.wantsToMeet("Ari"), 25000)) && (await bea.body()).includes(ONE_ON_ONE_COPY.requestsHere));
  await bea.go(`${SITE}/connections`);
  step("…and in Connections → Requests", (await bea.until(ONE_ON_ONE_COPY.wantsToMeet("Ari"), 25000)) && (await bea.body()).includes(ONE_ON_ONE_COPY.requests));
  await bea.click(ONE_ON_ONE_COPY.accept);
  let at = "";
  for (let t = 0; t < 30 && !at.startsWith("/chat/"); t++) { await sleep(500); at = await bea.path(); }
  const chatId = at.replace("/chat/", "");
  step("Accept opens Bea's chat", at.startsWith("/chat/") && (await bea.until(ONE_ON_ONE_COPY.firstLine)));
  step("…with nothing asked about a place or time (the row is optional, nothing is open)", (await bea.body()).includes(ONE_ON_ONE_COPY.addPlace) && !(await bea.body()).includes(ONE_ON_ONE_COPY.timePlaceholder));
  const [conn] = await must(await rest(`/rest/v1/connections?id=eq.${chatId}&select=person_a,person_b`), "the connection");
  step("the yes made them connections", conn && [conn.person_a, conn.person_b].sort().join() === [people.Ari.personId, people.Bea.personId].sort().join());
  const told = await must(await rest(`/rest/v1/notifications?person_id=eq.${people.Ari.personId}&kind=eq.plan_status&select=body`), "Ari's #3");
  step("Ari is told Bea said yes (#3), with no spot to pick", told.some((x) => /said yes\. Say hi\.$/.test(x.body)));

  // They write to each other, each in their own browser.
  step("Bea writes", (await bea.type(SOLO_COPY.threadPlaceholder("Ari"), "hi Ari")) && (await bea.sendMessage()));
  step("…and sees it", await bea.until("hi Ari"));
  await ari.go(`${SITE}/connections`);
  step("Ari's Connections lists Bea, with the chat's last line", (await ari.until("Bea", 25000)) && (await ari.until("Bea: hi Ari")));
  const toProfile = await ari.evaluate(`(() => { const r=[...document.querySelectorAll('[role=button]')].find(e=>e.innerText.includes("Bea: hi Ari")); if(!r) return false; r.click(); return true; })()`);
  step("tapping Bea opens her profile, with 'Message'", toProfile && (await ari.until(ONE_ON_ONE_COPY.message)) && (await ari.path()).startsWith("/person/"));
  await ari.click(ONE_ON_ONE_COPY.message);
  let ariAt = "";
  for (let t = 0; t < 30 && !ariAt.startsWith("/chat/"); t++) { await sleep(500); ariAt = await ari.path(); }
  step("'Message' opens the same chat — one chat per pair", ariAt === `/chat/${chatId}` && (await ari.until("hi Ari")));
  step("Ari answers", (await ari.type(SOLO_COPY.threadPlaceholder("Bea"), "hey Bea")) && (await ari.sendMessage()));
  step("…and Bea reads it in her open chat", await bea.until("hey Bea", 30000));

  // "Not now" is silent: Cal's request goes from Bea's Requests, and Cal still sees it sent.
  await person("Cal", "man");
  const [second] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: `Pair check 2 ${Date.now()}`, starts_at: new Date(Date.now() + 4 * 86_400_000).toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "second gathering");
  extra.push(second.id);
  for (const nm of ["Bea", "Cal"]) await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: second.id, person_id: people[nm].personId, party_total: 1, open_to_meeting: true }) }), `pin ${nm} 2`);
  const early = await as("Cal", "propose_solo", { p_gathering: second.id, p_to: people.Bea.personId, p_spot: null, p_meet_at: null, p_line: null });
  step("Bea, switched on only at the first event, cannot be asked at the second", !early.ok);
  for (const nm of ["Bea", "Cal"]) await must(await as(nm, "set_event_one_on_one", { p_gathering: second.id, p_on: true, p_audience: "everyone" }), `${nm} 1-on-1 on at the second`);
  await must(await as("Cal", "propose_solo", { p_gathering: second.id, p_to: people.Bea.personId, p_spot: null, p_meet_at: null, p_line: null }), "Cal asks Bea");
  await bea.go(`${SITE}/connections`);
  step("Cal's request reaches Bea's Requests", await bea.until(ONE_ON_ONE_COPY.wantsToMeet("Cal"), 25000));
  await bea.click(ONE_ON_ONE_COPY.notNow);
  let gone = false;
  for (let t = 0; t < 20 && !gone; t++) { await sleep(500); gone = !(await bea.body()).includes(ONE_ON_ONE_COPY.wantsToMeet("Cal")); }
  step("'Not now' takes it off Bea's Requests", gone);
  const cals = await must(await as("Cal", "my_solo_proposals", { p_gathering: second.id }), "Cal's requests");
  step("…and Cal is not told: his request still reads as sent", cals.length === 1 && cals[0].direction === "sent");

  // Calling it off ends the chat and the connection, for both, silently.
  await ari.go(`${SITE}/chat/${chatId}`);
  await ari.until("hey Bea");
  await ari.evaluate(`(() => { const b=[...document.querySelectorAll('[aria-label=More]')].pop(); b && b.click(); return !!b; })()`);
  step("Ari's chat offers 'Call off this 1-on-1'", await ari.until(SOLO_COPY.callOff));
  await ari.click(SOLO_COPY.callOff);
  let left = [];
  for (let t = 0; t < 20; t++) { await sleep(500); left = await must(await rest(`/rest/v1/connections?id=eq.${chatId}&select=id`), "the connection"); if (!left.length) break; }
  step("the connection is gone", left.length === 0);
  await bea.go(`${SITE}/chat/${chatId}`);
  step("…and Bea's chat has ended", await bea.until(ONE_ON_ONE_COPY.chatEnded, 25000));
  const offNotes = await must(await rest(`/rest/v1/notifications?person_id=eq.${people.Bea.personId}&kind=eq.plan_status&select=body`), "Bea's notifications");
  step("…and Bea was not told", !offNotes.some((x) => / is off\.$/.test(x.body)));
  ari.close();
  bea.close();
} catch (err) {
  console.log(String(err.message ?? err));
  ok = false;
} finally {
  for (const c of chromes) c.kill();
  for (const id of [...extra, ...(gathering ? [gathering.id] : [])]) {
    const crews = await (await rest(`/rest/v1/crews?gathering_id=eq.${id}&select=id`)).json().catch(() => []);
    for (const c of Array.isArray(crews) ? crews : []) await rest(`/rest/v1/notifications?crew_id=eq.${c.id}`, { method: "DELETE" });
    await rest(`/rest/v1/solo_proposals?gathering_id=eq.${id}`, { method: "DELETE" });
    await rest(`/rest/v1/crews?gathering_id=eq.${id}`, { method: "DELETE" });
    await rest(`/rest/v1/gatherings?id=eq.${id}`, { method: "DELETE" });
  }
  for (const p of Object.values(people)) {
    await rest(`/rest/v1/notifications?person_id=eq.${p.personId}`, { method: "DELETE" });
    await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: p.authId, p_on: false, p_actor: "pair-check" }) }).catch(() => undefined);
    await rest(`/rest/v1/people?auth_user_id=eq.${p.authId}`, { method: "DELETE" });
    await rest(`/auth/v1/admin/users/${p.authId}`, { method: "DELETE" });
  }
}
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
