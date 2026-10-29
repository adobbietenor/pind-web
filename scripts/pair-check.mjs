// #17 — "Let's meet up!", walked in real headless Chrome (A28, A29; Alex, 29 Oct 2026).
//
//   Ari (the browser, signed in through the sealed hand-off as the app is) sees Bea in
//   1-on-1 and taps "Let's meet up!" — nothing asked first. Bea says yes (her own session).
//   Ari's crowd page shows the pair; the pair's screen asks them to pick a spot. Ari suggests
//   one from the chips; the page says it is Bea's to say yes to, and offers Ari no "Sounds
//   good". Bea confirms (her own session): Ari's screen is the plan, and Ari is told (#3).
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
import { SOLO_COPY } from "../packages/shared/src/solo.ts";
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
  people[label] = { authId: u.id, personId: p.id, refresh: t.refresh_token, access: t.access_token };
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
    await must(await rest(`/rest/v1/pins?gathering_id=eq.${gathering.id}&person_id=eq.${people[n].personId}`, { method: "PATCH", body: JSON.stringify({ solo_opt_in: true, solo_visibility: "everyone" }) }), `${n} 1-on-1 on`);
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

  // A28: "Let's meet up!" — one tap, nothing asked first.
  await send("Page.navigate", { url: `${SITE}/crowd/${slug}` });
  step("A28 offers Bea with 'Let's meet up!'", (await until(SOLO_COPY.letsMeetUp, 25000)) && (await body()).includes("Bea"));
  step("…and no proposal sheet: no spot or time asked first", !(await body()).includes(SOLO_COPY.propose));
  await click(SOLO_COPY.letsMeetUp);
  step("one tap sends it: 'Sent'", await until(SOLO_COPY.sent));
  const [inv] = await must(await rest(`/rest/v1/solo_proposals?gathering_id=eq.${gathering.id}&from_person=eq.${people.Ari.personId}&select=id,spot_id,meet_at,status`), "the invite");
  step("…an invite with no spot and no time", inv && inv.spot_id === null && inv.meet_at === null && inv.status === "open");

  // Bea says yes, as herself: a pair.
  const crew = await must(await as("Bea", "respond_to_solo", { p_proposal: inv.id, p_accept: true }), "Bea says yes");
  await send("Page.reload");
  step("Ari's crowd page shows the pair", await until(SOLO_COPY.pairHeading("Bea"), 25000));
  await click(SOLO_COPY.openPlan);
  for (let t = 0; t < 30 && (await path()) !== `/group/${crew}`; t++) await sleep(500);
  step("…which opens the pair's own screen", (await path()) === `/group/${crew}`);
  step("the pair's screen asks them to pick a spot", (await until(SOLO_COPY.pairPick)) && (await body()).includes(SOLO_COPY.pairSuggest));

  // A29: Ari suggests a spot and a time — chips, nothing to type.
  await click(SOLO_COPY.pairSuggest);
  step("suggesting offers the venue's spots and the times as chips", await until(SOLO_COPY.pairSend));
  const picked = await evaluate(`(() => { const r=[...document.querySelectorAll('[role=radio]')]; if (r.length < ${spots.length + 1}) return false; r[0].click(); r[${spots.length}].click(); return true; })()`);
  step("a spot and a time can be picked", picked === true);
  await sleep(400);
  await click(SOLO_COPY.pairSend);
  let sug = [];
  for (let t = 0; t < 20 && !sug.length; t++) { await sleep(500); sug = await must(await rest(`/rest/v1/solo_spot_suggestions?crew_id=eq.${crew}&select=spot_id,suggested_by`), "suggestion"); }
  step("the suggestion is Ari's, one of the venue's spots", sug.length === 1 && sug[0].suggested_by === people.Ari.personId && spots.some((s) => s.id === sug[0].spot_id));
  step("the page says it is Bea's to say yes to", await until("It's Bea's to say yes to"));
  step("…and offers Ari no 'Sounds good' for her own", !(await body()).includes(SOLO_COPY.pairConfirm));

  // Bea confirms, as herself: a plan.
  await must(await as("Bea", "confirm_solo_spot", { p_crew: crew }), "Bea confirms");
  await send("Page.reload");
  step("Ari's screen is the plan now", await until(SOLO_COPY.planHeading("Bea"), 25000));
  const [c] = await must(await rest(`/rest/v1/crews?id=eq.${crew}&select=state,spot_id`), "the plan");
  step("…spot set, at the suggested spot", c.state === "spot_set" && c.spot_id === sug[0].spot_id);
  const told = await must(await rest(`/rest/v1/notifications?person_id=eq.${people.Ari.personId}&crew_id=eq.${crew}&select=body`), "Ari's #3");
  step("Ari, who suggested it, is told it is a plan (#3)", told.some((x) => /^Bea said yes: you're meeting at /.test(x.body)));
  ws.close();
} catch (err) {
  console.log(String(err.message ?? err));
  ok = false;
} finally {
  chrome?.kill();
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
