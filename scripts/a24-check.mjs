// A24, walked in real headless Chrome (Alex, 16 Nov 2026): report and block from a profile,
// and Settings → Blocked people with Unblock, as a signed-in person.
//
//   Ari opens Bea's profile: "⋯" → Block Bea → Block: "You've blocked Bea", and the block is
//   in the database. Settings → Blocked people lists Bea; Unblock says what it does and doesn't
//   give back, then lifts it. Then "⋯" → a reason: the confirmation says a person reviews it
//   within 24 hours, and the report is filed — and, both being harness people, the admin is
//   not emailed (report_alert_wanted, P318).
//
//   npm run check:a24
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal } from "../src/public/sealed.ts";
import { A24_COPY } from "../packages/shared/src/a24.ts";
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
  const email = `pind-a24check-${label.toLowerCase()}-${Date.now()}@example.com`;
  const password = randomUUID();
  const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), `user ${label}`);
  const [p] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: u.id, first_name: label, photo_path: `${u.id}/face.png` }) }), `person ${label}`);
  await must(await rest("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: p.id, gender, birth_year: 1994 }) }), "private");
  await must(await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: p.id, source: "a26" }) }), "19+");
  await must(await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: u.id, p_on: true, p_actor: "a24-check", p_note: "a24-check" }) }), "tester");
  const t = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "sign in");
  people[label] = { authId: u.id, personId: p.id, refresh: t.refresh_token, access: t.access_token, session: t };
}
// As the person themselves, with their own token — never the service key for a product act.
const as = (label, fn, args) =>
  fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${people[label].access}`, "content-type": "application/json" }, body: JSON.stringify(args) });

// One person's own browser: its own Chrome, profile and session.
async function browser() {
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-a24-"))}`, "about:blank"], { stdio: "ignore" });
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
  [gathering] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: `A24 check ${Date.now()}`, starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "gathering");
  await person("Ari", "woman");
  await person("Bea", "woman");
  for (const n of ["Ari", "Bea"]) await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: gathering.id, person_id: people[n].personId, party_total: 1, open_to_meeting: true }) }), `pin ${n}`);
  const ari = await browser();
  const cookie = await seal(process.env.SESSION_SECRET, { userId: people.Ari.authId, refreshToken: people.Ari.refresh, issuedAt: Date.now() });
  await ari.send("Network.setCookie", { name: "pind_pin", value: cookie, domain: new URL(SITE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
  const moreOnce = () => ari.evaluate(`(() => { const b=[...document.querySelectorAll('[aria-label=${JSON.stringify(A24_COPY.more)}]')].pop(); if(!b) return false; b.click(); return true; })()`);
  // The ⋯ draws with the profile; tap it once it is there (a race, not a product fault).
  const more = async () => { for (let t = 0; t < 20; t++) { if (await moreOnce()) return true; await sleep(250); } return false; };
  const blocks = async () => must(await rest(`/rest/v1/blocks?blocker_id=eq.${people.Ari.personId}&blocked_id=eq.${people.Bea.personId}&select=blocker_id`), "blocks");

  // Block from the profile.
  await ari.go(`${SITE}/person/${people.Bea.personId}`);
  const seen = await ari.until("Bea", 25000);
  if (!seen) console.log(`   page: ${JSON.stringify((await ari.body()).slice(0, 300))} at ${await ari.path()}`);
  step("Bea's profile has its ⋯", seen && (await more()));
  step("…which opens A24: the reasons and Block", (await ari.until(A24_COPY.report("Bea"))) && (await ari.until("Spam")) && (await ari.body()).includes(A24_COPY.block("Bea")));
  await ari.click(A24_COPY.block("Bea"));
  step("Block says what it does, and that they aren't told", await ari.until(A24_COPY.blockWhat));
  await ari.click(A24_COPY.blockConfirm);
  step("…'You've blocked Bea'", await ari.until(A24_COPY.blockedTitle("Bea")));
  step("…and the block is in the database", (await blocks()).length === 1);

  // Settings → Blocked people → Unblock.
  await ari.go(`${SITE}/blocked`);
  step("Settings → Blocked people lists Bea", (await ari.until(A24_COPY.blockedHeading, 25000)) && (await ari.until("Bea")));
  await ari.click(A24_COPY.unblock);
  step("Unblock says what it does and doesn't give back", await ari.until(A24_COPY.unblockWhat));
  await ari.click(A24_COPY.unblock);
  step("…'Bea is unblocked'", await ari.until(A24_COPY.unblocked("Bea")));
  step("…and the block is gone", (await blocks()).length === 0);

  // Report from the profile.
  await ari.go(`${SITE}/person/${people.Bea.personId}`);
  await ari.until("Bea", 25000);
  await more();
  await ari.until("Spam");
  await ari.click("Spam");
  step("a reason files it: a person reviews within 24 hours", (await ari.until(A24_COPY.reportedTitle)) && (await ari.body()).includes("within 24 hours"));
  const filed = await must(await rest(`/rest/v1/reports?reporter_id=eq.${people.Ari.personId}&target_person_id=eq.${people.Bea.personId}&select=reason`), "reports");
  step("…the report is on Bea, for spam", filed.length === 1 && filed[0].reason === "spam");
  const wanted = await must(await rest("/rest/v1/rpc/admin_report_alert_wanted", { method: "POST", body: JSON.stringify({ p_reporter: people.Ari.personId, p_target: people.Bea.personId }) }), "wanted");
  step("…and, both being harness people, the admin is not emailed", wanted === false);
  ari.close();
} catch (err) {
  console.log(String(err.message ?? err));
  ok = false;
} finally {
  for (const c of chromes) c.kill();
  const ids = Object.values(people).map((p) => p.personId);
  if (ids.length) {
    await rest(`/rest/v1/reports?reporter_id=in.(${ids.join(",")})`, { method: "DELETE" });
    await rest(`/rest/v1/blocks?blocker_id=in.(${ids.join(",")})`, { method: "DELETE" });
  }
  if (gathering) await rest(`/rest/v1/gatherings?id=eq.${gathering.id}`, { method: "DELETE" });
  for (const p of Object.values(people)) {
    await rest(`/rest/v1/notifications?person_id=eq.${p.personId}`, { method: "DELETE" });
    await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: p.authId, p_on: false, p_actor: "a24-check" }) }).catch(() => undefined);
    await rest(`/rest/v1/people?auth_user_id=eq.${p.authId}`, { method: "DELETE" });
    await rest(`/auth/v1/admin/users/${p.authId}`, { method: "DELETE" });
  }
}
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
