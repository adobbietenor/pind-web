// Screenshots of app screens as an anonymous tester pinned at the test crowd, for UI pass
// 1's browser checks against its mockups (docs/design/ui-pass-1). Not a pass/fail check:
// it walks a real session, saves PNGs to the directory given, prints each page's text,
// and removes everything it made.
//
//   node --env-file=.dev.vars scripts/ui-shots.mjs <out-dir> [open]
//
// Without "open" the pin is not open to meeting (A9's 023); with it, the pin opts in as
// far as an anonymous person can (the A9 that asks for a profile).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal } from "../src/public/sealed.ts";
import { needChrome, needEnv, sessionSecretMatches, testCrowd } from "./fixture.mjs";

needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SESSION_SECRET");
const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
needChrome(CHROME);
await sessionSecretMatches(SITE);
const out = process.argv[2];
if (!out) throw new Error("usage: ui-shots.mjs <out-dir>");
mkdirSync(out, { recursive: true });
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rest = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json", ...(init.headers ?? {}) } });

const crowd = await testCrowd({ pinnable: true });
const signup = await (await fetch(`${base}/auth/v1/signup`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ data: {} }) })).json();
const userId = signup.user.id;
await rest(`/auth/v1/admin/users/${userId}`, { method: "PUT", body: JSON.stringify({ app_metadata: { pind_harness: true } }) });
await rest("/rest/v1/rpc/admin_add_anonymous_tester", { method: "POST", body: JSON.stringify({ p_user: userId, p_actor: "ui-shots" }) });
const cookie = await seal(process.env.SESSION_SECRET, { userId, refreshToken: signup.refresh_token, issuedAt: Date.now() });

const port = 9500 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-shots-"))}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let ws;
try {
  for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0; const wait = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id)); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const body = () => evaluate("document.body.innerText").then(String);
  const until = async (text, ms = 20000) => { for (let t = 0; t < ms; t += 500) { if ((await body()).includes(text)) return true; await sleep(500); } return false; };
  const click = (text) => evaluate(`(() => { const els=[...document.querySelectorAll('[role=checkbox],[role=button],[role=radio],button,div,a')].filter(e=>e.innerText&&e.innerText.trim()===${JSON.stringify(text)}); const e=els[els.length-1]; if(!e) return false; e.click(); return true; })()`);
  const snap = async (name) => {
    await sleep(1200);
    const h = await evaluate("document.documentElement.scrollHeight");
    await send("Emulation.setDeviceMetricsOverride", { width: 393, height: Math.min(Math.max(h, 852), 4000), deviceScaleFactor: 2, mobile: true });
    await sleep(500);
    writeFileSync(join(out, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
    console.log(`== ${name}\n${(await body()).slice(0, 900)}\n`);
    await send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  };
  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  await send("Network.setCookie", { name: "pind_pin", value: cookie, domain: new URL(SITE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });

  // The app's own A26, as a stranger would fill it: a name, the 19+ tick, the button.
  await send("Page.navigate", { url: `${SITE}/pin/${crowd.slug}` });
  await until("I'm 19 or older");
  await evaluate(`(() => { const i=document.querySelector('input'); i.focus(); })()`);
  await send("Input.insertText", { text: "Shots" });
  if (process.argv[3] === "open") await click("I'd like to meet up with others going");
  await click("I'm 19 or older");
  await sleep(300);
  await evaluate(`(() => { const b=[...document.querySelectorAll('[role=button]')].filter(e=>/^Pin in/.test(e.innerText.trim())).pop(); b && b.click(); })()`);
  for (let t = 0; t < 40 && !String(await evaluate("location.pathname")).startsWith("/crowd/"); t++) {
    await sleep(500);
    // "You're in" and its next step, where A26 stops before the crowd page.
    const b = await body();
    if (b.includes("See who's going") || b.includes("See who’s going")) await click("See who’s going") || await click("See who's going");
  }
  if (!String(await evaluate("location.pathname")).startsWith("/crowd/")) await send("Page.navigate", { url: `${SITE}/crowd/${crowd.slug}` });
  await until("Test crowd");
  await snap("a9");
  await send("Page.navigate", { url: `${SITE}/crowds` });
  await until("Find your crowd");
  await snap("a5");
} finally {
  ws?.close();
  chrome.kill();
  const [person] = await (await rest(`/rest/v1/people?auth_user_id=eq.${userId}&select=id`)).json();
  if (person?.id) await rest(`/rest/v1/pins?person_id=eq.${person.id}`, { method: "DELETE" });
  await rest("/rest/v1/rpc/admin_clear_anonymous_tester", { method: "POST", body: JSON.stringify({ p_user: userId }) });
  await rest(`/rest/v1/people?auth_user_id=eq.${userId}`, { method: "DELETE" });
  await rest(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
}
process.exit(0);
