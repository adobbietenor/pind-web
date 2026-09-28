// A27's refusal, fired from the screen (M3.2 walk).
//
// Alex reached the safety sheet after a merge, pressed "I'm in", and was told "Pin'd was
// not allowed to write that" — the gate refused, and the screen had only the fallback
// sentence. The gate's refusal had been proved from raw tokens (P105–P109), never from
// the screen. This walks it in real headless Chrome:
//
//   1. a test account that meets the gate opens A27 on the test crowd → the safety sheet;
//   2. its photo is taken away underneath the page (the state a merge left Alex in);
//   3. "I'm in" must say what is missing — the photo — and show the photo picker, never
//      "not allowed", and the pin must stay closed;
//   4. the other side: photo back, reload, "I'm in" must open the pin and land on A9;
//   5. the crowd stops being visible to the account → A27 says so, with a way on (never
//      blank — the walk's hang after a merge into an account that is not a tester).
//
//   npm run check:optin-refusal
//
// Needs .dev.vars (SUPABASE_*, SESSION_SECRET). The account is marked as a harness user
// (the photo check skips it), made a tester for the run, and deleted at the end.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal } from "../src/public/sealed.ts";
import { OPTIN_COPY, optInMissing } from "../packages/shared/src/optin.ts";

const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = (path, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
const must = async (res, what) => {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};

const [crowd] = await must(await admin(`/rest/v1/gatherings?name=eq.${encodeURIComponent("Test crowd — walk the list")}&is_seed=eq.true&select=id,slug`), "test crowd");
if (!crowd?.slug) throw new Error("no test crowd — build it first");

// 1. An account that meets the gate, pinned (closed) at the test crowd.
const email = `pind-optin-check-${Date.now()}@example.com`;
const password = randomUUID();
const user = await must(await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), "create user");
const authId = user.id;
let ok = false;
let chrome;
try {
  // Complete in every way A27 asks, "where" included (one set of profile steps, M3.2),
  // so the page opens on the safety sheet.
  const [person] = await must(await admin("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: authId, first_name: "Refusalcheck", photo_path: `${authId}/face.png`, neighbourhood: "king-west" }) }), "person");
  const tags = await must(await admin("/rest/v1/tags?select=slug&order=slug&limit=3"), "tags");
  await must(await admin("/rest/v1/person_tags", { method: "POST", body: JSON.stringify(tags.map((t) => ({ person_id: person.id, tag: t.slug }))) }), "person tags");
  await must(await admin("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: person.id, gender: "woman", birth_year: 1995 }) }), "people_private");
  // The 19+ record may already exist (written alongside people_private); make sure of it.
  await must(await admin("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: person.id, source: "a26" }) }), "19+");
  await must(await admin("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: crowd.id, person_id: person.id, party_total: 1, open_to_meeting: false }) }), "pin");
  await must(await admin("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: authId, p_on: true, p_actor: "optin-refusal-check", p_note: "optin-refusal-check" }) }), "tester");
  const tokens = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "sign in");
  const cookie = await seal(process.env.SESSION_SECRET, { userId: authId, refreshToken: tokens.refresh_token, issuedAt: Date.now() });

  const port = 9600 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-optin-"))}`, "about:blank"], { stdio: "ignore" });
  let ws;
  for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0; const wait = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id)); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const body = () => evaluate("document.body.innerText").then(String);
  const click = (text) => evaluate(`(() => { const els=[...document.querySelectorAll('[role=checkbox],[role=button],button,div,a')].filter(e=>e.innerText&&e.innerText.trim()===${JSON.stringify(text)}); const e=els[els.length-1]; if(!e) return false; e.click(); return true; })()`);
  const pinOpen = async () => (await must(await admin(`/rest/v1/pins?person_id=eq.${person.id}&gathering_id=eq.${crowd.id}&select=open_to_meeting`), "pin"))[0]?.open_to_meeting;
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1400, deviceScaleFactor: 2, mobile: true });
  await send("Network.setCookie", { name: "pind_pin", value: cookie, domain: new URL(SITE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });

  // A27 → the safety sheet (the account meets the gate).
  await send("Page.navigate", { url: `${SITE}/opt-in/${crowd.slug}` });
  await sleep(9000);
  const atSheet = (await body()).includes(OPTIN_COPY.safetyHeading);
  console.log(`1. the safety sheet shown: ${atSheet}`);

  // 2. The photo goes, underneath the page.
  await must(await admin(`/rest/v1/people?id=eq.${person.id}`, { method: "PATCH", body: JSON.stringify({ photo_path: null }) }), "take the photo");

  // 3. "I'm in" must say what is missing, where the fix is.
  await click(OPTIN_COPY.accept);
  await sleep(300);
  await click(OPTIN_COPY.finish);
  await sleep(5000);
  const said = await body();
  const expected = optInMissing({ permanent: true, hasPrivate: true, hasPhoto: false }).says;
  const refusal = {
    sentence: said.includes(expected),
    picker: said.includes("Choose a photo"),
    noFallback: !/not allowed|went wrong/i.test(said),
    stillClosed: (await pinOpen()) === false,
  };
  console.log(`3. refused with a sentence: ${JSON.stringify(refusal)}`);
  if (!refusal.sentence) console.log(`   page says: ${JSON.stringify(said.slice(0, 400))}`);

  // 4. The other side: complete again, and the same button opens the pin.
  await must(await admin(`/rest/v1/people?id=eq.${person.id}`, { method: "PATCH", body: JSON.stringify({ photo_path: `${authId}/face.png` }) }), "photo back");
  await send("Page.reload");
  await sleep(8000);
  await click(OPTIN_COPY.accept);
  await sleep(300);
  await click(OPTIN_COPY.finish);
  await sleep(6000);
  const landed = await evaluate("location.pathname");
  const opened = { landed, open: await pinOpen() };
  console.log(`4. complete → opens: ${JSON.stringify(opened)}`);

  // 5. The walk's hang: the crowd stops being visible to this account (a merge into an
  // account that is not a tester). A27 must say so and offer a way on — never blank.
  await must(await admin("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: authId, p_on: false, p_actor: "optin-refusal-check" }) }), "untester");
  await send("Page.navigate", { url: `${SITE}/opt-in/${crowd.slug}` });
  await sleep(8000);
  const blank = await body();
  const notBlank = { says: blank.includes("This crowd isn't open to the account you're signed in as."), wayOn: blank.includes("This week's crowds") };
  console.log(`5. crowd gone from under A27 → a sentence and a way on: ${JSON.stringify(notBlank)}`);

  ok = atSheet && Object.values(refusal).every(Boolean) && opened.landed === `/crowd/${crowd.slug}` && opened.open === true && notBlank.says && notBlank.wayOn;
  ws.close();
} finally {
  chrome?.kill();
  await admin("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: authId, p_on: false, p_actor: "optin-refusal-check" }) });
  await admin(`/rest/v1/people?auth_user_id=eq.${authId}`, { method: "DELETE" });
  await admin(`/auth/v1/admin/users/${authId}`, { method: "DELETE" });
}
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
