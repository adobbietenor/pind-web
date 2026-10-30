// 1-on-1, walked in real headless Chrome (A28, A29, A20; UI pass 1, Alex, 30 Oct 2026).
//
//   Ari (the browser, signed in through the sealed hand-off as the app is) sees Bea wear
//   "Open to 1-on-1", taps her, and sends "Let's meet up 1-on-1" from her profile sheet:
//   one tap, nothing asked first. Bea, in her own session, finds it in Connections →
//   Requests and accepts: the chat opens. She adds a place (a curated spot; nothing can be
//   typed) and a time, and it holds with no confirmation. Cal's request, answered "Not
//   now", leaves Bea's Requests and still reads as sent to Cal.
//
//   npm run check:pair
//
// Fixtures first (scripts/fixture.mjs): 1-on-1 needs the venue's curated spots, so a test
// crowd venue without any is a FIXTURE, not product failure. Every person is a harness user,
// removed at the end with their account.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal } from "../src/public/sealed.ts";
import { ONE_ON_ONE_COPY } from "../packages/shared/src/solo.ts";
import { fixture, needChrome, needEnv, sessionSecretMatches, testCrowd } from "./fixture.mjs";

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
const spots = await must(await rest(`/rest/v1/meeting_spots?venue_id=eq.${crowd.venue_id}&active=eq.true&select=id,name&order=name`), "spots");
if (!spots.length) fixture("the test crowd's venue has no active meeting spots, so 1-on-1 is not offered there — approve one on /admin/venues.");

const people = {};
const extra = [];
let gathering = null;
let chrome;
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

try {
  [gathering] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: `Pair check ${Date.now()}`, starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "gathering");
  const slug = await must(await rest("/rest/v1/rpc/admin_mint_slug", { method: "POST", body: JSON.stringify({ p_gathering: gathering.id }) }), "slug");
  await person("Ari", "woman");
  await person("Bea", "woman");
  for (const n of ["Ari", "Bea"]) {
    await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: gathering.id, person_id: people[n].personId, party_total: 1, open_to_meeting: true }) }), `pin ${n}`);
    // The account switch (UI pass 1), as the person.
    await must(await as(n, "set_one_on_one", { p_on: true, p_audience: "everyone" }), `${n} 1-on-1 on`);
  }

  const cookie = await seal(process.env.SESSION_SECRET, { userId: people.Ari.authId, refreshToken: people.Ari.refresh, issuedAt: Date.now() });
  const port = 9500 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-pair-"))}`, "about:blank"], { stdio: "ignore" });
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
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1800, deviceScaleFactor: 2, mobile: true });
  await send("Network.setCookie", { name: "pind_pin", value: cookie, domain: new URL(SITE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });

  // A28/A29 since UI pass 1: Bea wears "Open to 1-on-1" on Ari's list; the request lives on
  // her profile sheet, one tap, nothing asked first.
  await send("Page.navigate", { url: `${SITE}/crowd/${slug}` });
  step("Bea is on Ari's list with 'Open to 1-on-1'", await until(ONE_ON_ONE_COPY.tag, 25000));
  const tapped = await evaluate(`(() => { const r=[...document.querySelectorAll('[role=button]')].find(e=>e.innerText.includes("Bea") && e.innerText.includes(${JSON.stringify(ONE_ON_ONE_COPY.tag)})); if(!r) return false; r.click(); return true; })()`);
  step("tapping Bea opens her profile sheet", tapped && (await until(ONE_ON_ONE_COPY.ask)));
  await click(ONE_ON_ONE_COPY.ask);
  step("one tap sends it: 'Request sent'", await until(ONE_ON_ONE_COPY.sent("Bea")));
  const [inv] = await must(await rest(`/rest/v1/solo_proposals?gathering_id=eq.${gathering.id}&from_person=eq.${people.Ari.personId}&select=id,spot_id,meet_at,status`), "the request");
  step("…a request with no spot and no time", inv && inv.spot_id === null && inv.meet_at === null && inv.status === "open");

  // A20: Bea, in her own session, finds it in Connections → Requests and accepts.
  await evaluate(`(() => { localStorage.clear(); localStorage.setItem(${JSON.stringify(`sb-${ref}-auth-token`)}, ${JSON.stringify(JSON.stringify(people.Bea.session))}); return true; })()`);
  await send("Network.deleteCookies", { name: "pind_pin", domain: new URL(SITE).hostname });
  await send("Page.navigate", { url: `${SITE}/connections` });
  step("Bea's Connections has the request under Requests", (await until(ONE_ON_ONE_COPY.wantsToMeet("Ari"), 25000)) && (await body()).includes(ONE_ON_ONE_COPY.requests));
  await click(ONE_ON_ONE_COPY.accept);
  let at = "";
  for (let t = 0; t < 30 && !at.startsWith("/group/"); t++) { await sleep(500); at = await path(); }
  const crew = at.replace("/group/", "");
  step("Accept opens the chat", at.startsWith("/group/") && (await until(ONE_ON_ONE_COPY.firstLine)));

  // A29: either of them adds a place and a time; nobody confirms.
  await click(ONE_ON_ONE_COPY.addPlace);
  step("'Add a place or time' offers the venue's spots and the event itself, no address", (await until(ONE_ON_ONE_COPY.atTheEvent)) && (await evaluate("document.querySelectorAll('input').length")) === 1);
  await click(spots[0].name);
  await evaluate(`(() => { const i=[...document.querySelectorAll('input')].find(x=>x.placeholder===${JSON.stringify(ONE_ON_ONE_COPY.timePlaceholder)}); i && i.focus(); return !!i; })()`);
  await send("Input.insertText", { text: "around 7" });
  await click(ONE_ON_ONE_COPY.save);
  step("the row shows the place and the time", await until(`${spots[0].name} · around 7`));
  const [c] = await must(await rest(`/rest/v1/crews?id=eq.${crew}&select=state,spot_id,time_note`), "the chat");
  step("…held at once, with no confirmation step", c.state === "spot_set" && c.spot_id === spots[0].id && c.time_note === "around 7");

  // "Not now" is silent: Cal's request goes from Bea's Requests, and Cal still sees it sent.
  await person("Cal", "man");
  await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: gathering.id, person_id: people.Cal.personId, party_total: 1, open_to_meeting: true }) }), "pin Cal");
  await must(await as("Cal", "set_one_on_one", { p_on: true, p_audience: "everyone" }), "Cal 1-on-1 on");
  // Bea is in a 1-on-1 here now, so Cal asks her at a second gathering.
  const [second] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: `Pair check 2 ${Date.now()}`, starts_at: new Date(Date.now() + 4 * 86_400_000).toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "second gathering");
  extra.push(second.id);
  for (const nm of ["Bea", "Cal"]) await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: second.id, person_id: people[nm].personId, party_total: 1, open_to_meeting: true }) }), `pin ${nm} 2`);
  await must(await as("Cal", "propose_solo", { p_gathering: second.id, p_to: people.Bea.personId, p_spot: null, p_meet_at: null, p_line: null }), "Cal asks Bea");
  await send("Page.navigate", { url: `${SITE}/connections` });
  step("Cal's request reaches Bea's Requests", await until(ONE_ON_ONE_COPY.wantsToMeet("Cal"), 25000));
  await click(ONE_ON_ONE_COPY.notNow);
  let gone = false;
  for (let t = 0; t < 20 && !gone; t++) { await sleep(500); gone = !(await body()).includes(ONE_ON_ONE_COPY.wantsToMeet("Cal")); }
  step("'Not now' takes it off Bea's Requests", gone);
  const cals = await must(await as("Cal", "my_solo_proposals", { p_gathering: second.id }), "Cal's requests");
  step("…and Cal is not told: his request still reads as sent", cals.length === 1 && cals[0].direction === "sent");
  ws.close();
} catch (err) {
  console.log(String(err.message ?? err));
  ok = false;
} finally {
  chrome?.kill();
  for (const id of extra) {
    await rest(`/rest/v1/solo_proposals?gathering_id=eq.${id}`, { method: "DELETE" });
    await rest(`/rest/v1/gatherings?id=eq.${id}`, { method: "DELETE" });
  }
  if (gathering) {
    const crews = await (await rest(`/rest/v1/crews?gathering_id=eq.${gathering.id}&select=id`)).json().catch(() => []);
    for (const c of Array.isArray(crews) ? crews : []) await rest(`/rest/v1/notifications?crew_id=eq.${c.id}`, { method: "DELETE" });
    await rest(`/rest/v1/solo_proposals?gathering_id=eq.${gathering.id}`, { method: "DELETE" });
    await rest(`/rest/v1/crews?gathering_id=eq.${gathering.id}`, { method: "DELETE" });
    await rest(`/rest/v1/gatherings?id=eq.${gathering.id}`, { method: "DELETE" });
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
