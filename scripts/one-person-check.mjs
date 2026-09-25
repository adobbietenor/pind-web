// One person whichever page they are on (Alex, M3.2) — checked in a REAL browser.
//
// The sequence Alex asked for: quick pin on the Worker → the app's "change or remove my
// pin" (which claims the session) → quick pin again in the same browser. It must end
// as ONE person, not two. The redirect that makes it so is page JavaScript (the
// Worker's A26 sends a signed-in browser to the app's A26), so no unit test can reach
// it — this drives headless Chrome over the DevTools protocol, then asks the database.
//
//   npm run check:one-person -- <slug>           must report 1 person (exit 0)
//   npm run check:one-person -- <slug> --break   clears the browser's storage before the
//                                                second pin — a second browser, in effect —
//                                                and must report 2 (proves the check can fail)
//
// Run it after any deploy that touches A26, the claim or the app's session handling.
// It pins on a real gathering on staging and deletes everything it made.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const slug = process.argv[2];
const broken = process.argv.includes("--break");
if (!slug) throw new Error("usage: one-person-check.mjs <slug> [--break]");
const name = `OnePerson${Date.now() % 100000}`;
const expected = broken ? 2 : 1;

const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = (path, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, ...(init.headers ?? {}) } });

const profile = mkdtempSync(join(tmpdir(), "pind-one-person-"));
const port = 9300 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 60 && !ws; i++) {
  await sleep(250);
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
}
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let n = 0;
const waiting = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) (waiting.get(m.id)(m), waiting.delete(m.id));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++n; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const go = async (url, wait) => { await send("Page.navigate", { url }); await sleep(wait); };
await send("Page.enable");
await send("Runtime.enable");

const pin = `(() => { const f = document.querySelector('form.qp'); if (!f) return 'redirected to ' + location.pathname;
  f.first_name.value = ${JSON.stringify(name)}; f.nineteen.checked = true; f.submit(); return 'pinned on the Worker'; })()`;

let people = -1;
try {
  await go(`${SITE}/g/${slug}/pin`, 4000);
  console.log("1 quick pin:        ", await evaluate(pin));
  await sleep(4000);
  await go(`${SITE}/pin/${slug}`, 9000);
  console.log("2 app claims:       ", await evaluate(`'session in this browser: ' + Object.keys(localStorage).some(k => k.endsWith('-auth-token'))`));
  if (broken) await evaluate(`localStorage.clear(), 'storage cleared (--break)'`);
  await go(`${SITE}/g/${slug}/pin`, 6000);
  console.log("3 quick pin again:  ", await evaluate(pin));
  await sleep(4000);

  const found = await (await admin(`/rest/v1/people?first_name=eq.${name}&select=id,auth_user_id`)).json();
  people = found.length;
  console.log(`people named ${name}: ${people} (expected ${expected})`);
  for (const p of found) {
    await admin(`/rest/v1/people?id=eq.${p.id}`, { method: "DELETE" });
    if (p.auth_user_id) await admin(`/auth/v1/admin/users/${p.auth_user_id}`, { method: "DELETE" });
  }
  console.log("cleaned up");
} finally {
  ws.close();
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
if (people !== expected) {
  console.error(`FAIL: ${people} people, expected ${expected}`);
  process.exit(1);
}
console.log("PASS");
