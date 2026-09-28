// The anonymous-tester button's whole path, from outside Access (M3.2).
//
// /admin/testers → "Start an anonymous tester session in this browser" does three things:
// signs up a fresh anonymous user, makes it a tester (admin_add_anonymous_tester), and
// hands it to the browser as the quick pin's sealed cookie, which the app must CLAIM.
// The first version of this check put the session straight into localStorage — it
// skipped the claim, the one step the button depends on, and passed while the button
// failed (Alex, 25 Sept). This one does exactly what the button does, sets the cookie
// in real headless Chrome, and loads the page the button redirects to:
//
//   npm run check:tester-session        must render the test crowd, not "Not on Pin'd"
//
// Needs .dev.vars (SUPABASE_*, SESSION_SECRET — the same secret the Worker seals with,
// which this also proves). Clears the session it made.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal } from "../src/public/sealed.ts";

const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
const shotTo = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json", ...(init.headers ?? {}) } });

// Where the button redirects: the test crowd.
const [crowd] = await (await admin(`/rest/v1/gatherings?name=eq.${encodeURIComponent("Test crowd — walk the list")}&is_seed=eq.true&select=slug,starts_at,ends_at`)).json();
if (!crowd?.slug) throw new Error("no test crowd — build it first");

// 1. What the button does: sign up anonymously, make a tester, seal the cookie.
const signup = await (await fetch(`${base}/auth/v1/signup`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ data: {} }) })).json();
const userId = signup.user.id;
const added = await admin("/rest/v1/rpc/admin_add_anonymous_tester", { method: "POST", body: JSON.stringify({ p_user: userId, p_actor: "tester-session-check" }) });
if (!added.ok) throw new Error(`admin_add_anonymous_tester: ${added.status} ${await added.text()}`);
const cookie = await seal(process.env.SESSION_SECRET, { userId, refreshToken: signup.refresh_token, issuedAt: Date.now() });

// 2. The browser the button hands it to.
const port = 9400 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-tester-"))}`, "about:blank"], { stdio: "ignore" });
let ws;
for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let n = 0; const wait = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1400, deviceScaleFactor: 2, mobile: true });
await send("Network.setCookie", { name: "pind_pin", value: cookie, domain: new URL(SITE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });

// 3. The page the button redirects to, loaded cold — the claim must happen here.
await send("Page.navigate", { url: `${SITE}/crowd/${crowd.slug}` });
await sleep(10000);
const body = await evaluate("document.body.innerText");
const claimed = await evaluate("Object.keys(localStorage).some(k => k.endsWith('-auth-token'))");
if (shotTo) writeFileSync(shotTo, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
ws.close();
chrome.kill();
await admin("/rest/v1/rpc/admin_clear_anonymous_tester", { method: "POST", body: JSON.stringify({ p_user: userId }) });

console.log(`test crowd: ${crowd.slug} (starts ${crowd.starts_at})`);
console.log(`session claimed into the app: ${claimed}`);
console.log(`page begins: ${JSON.stringify(String(body).slice(0, 90))}`);
const ok = claimed && String(body).includes("Test crowd") && !String(body).includes("Not on Pin'd");
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
