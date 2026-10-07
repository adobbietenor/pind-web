// The app's home (M3.3c), walked in real headless Chrome as an iPhone, the way the other
// checks walk their screens:
//
//   A5   four cities; Toronto opens; Vancouver, Calgary and Montreal say "Coming soon"
//        and a tap on one goes nowhere
//   A6/7 Toronto's list is W1's list — the same gatherings this week, compared by name
//        against the live pind.social page, read the same minute
//   *    a card opens the app's crowd page (A8); "Set up my profile" opens sign-in
//
//   npm run check:home
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CITIES, HOME_COPY } from "../packages/shared/src/cities.ts";
import { fixture, needChrome } from "./fixture.mjs";

const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
needChrome(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const step = (name, pass) => { console.log(`${pass ? "ok  " : "FAIL"} ${name}`); if (!pass) { ok = false; throw new Error(`stopped at: ${name}`); } };

// W1, as a reader gets it: this week's Events cards, by name.
const w1 = await (await fetch(`${SITE}/?x=${Date.now()}`)).text();
const w1Names = [...w1.matchAll(/<a class="card"[^>]*>[\s\S]*?<div class="name">([^<]*)/g)].map((m) => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim());
if (w1Names.length === 0) fixture("W1 shows no crowds this week, so there is nothing to compare the app's list with.");

let chrome;
try {
  const port = 9500 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-home-"))}`, "about:blank"], { stdio: "ignore" });
  let ws;
  for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0; const wait = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id)); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const body = () => evaluate("document.body.innerText").then(String);
  const until = async (text, ms = 20000) => { for (let t = 0; t < ms; t += 500) { if ((await body()).includes(text)) return true; await sleep(500); } return false; };
  const path = () => evaluate("location.pathname");
  const click = (text) => evaluate(`(() => { const els=[...document.querySelectorAll('[role=button],[role=link],[role=tab],button,div,a')].filter(e=>e.innerText&&e.innerText.trim()===${JSON.stringify(text)}); const e=els[els.length-1]; if(!e) return false; e.click(); return true; })()`);
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 2400, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });

  // A5 — the cities.
  await send("Page.navigate", { url: `${SITE}/crowds` });
  step("A5 opens with its heading", await until(HOME_COPY.heading));
  const home = await body();
  step("all four cities are listed", CITIES.every((c) => home.includes(c.name)));
  step("three say 'Coming soon'", home.split(HOME_COPY.comingSoon).length - 1 === CITIES.filter((c) => !c.live).length);
  for (const c of CITIES.filter((x) => !x.live)) {
    await evaluate(`(() => { const e=[...document.querySelectorAll('[role=button]')].find(x=>x.innerText.includes(${JSON.stringify(c.name)})); e && e.click(); })()`);
    await sleep(600);
    step(`a tap on ${c.name} goes nowhere`, (await path()) === "/crowds");
  }
  step("profile setup is offered, optional", home.includes(HOME_COPY.profileButton));

  // A6/A7 — Toronto's list is W1's list.
  await click("Toronto");
  for (let t = 0; t < 30 && (await path()) !== "/city/toronto"; t++) await sleep(500);
  step("Toronto opens its list", (await path()) === "/city/toronto");
  step("the list loads", await until("This week's crowds"));
  await sleep(1500);
  const appNames = await evaluate(`[...document.querySelectorAll('[role=link]')].map(e => e.innerText.split("\\n")[1]?.trim()).filter(Boolean)`);
  console.log(`     W1 ${w1Names.length} this week, the app ${appNames.length}`);
  const missing = w1Names.filter((x) => !appNames.includes(x));
  const extra = appNames.filter((x) => !w1Names.includes(x));
  step("the app's Toronto list has every gathering W1 has", missing.length === 0 || (console.log(`     missing: ${missing.slice(0, 5).join(" | ")}`), false));
  step("…and nothing W1 does not", extra.length === 0 || (console.log(`     extra: ${extra.slice(0, 5).join(" | ")}`), false));

  // A card opens the app's crowd page.
  await evaluate(`[...document.querySelectorAll('[role=link]')][0].click()`);
  for (let t = 0; t < 30 && !String(await path()).startsWith("/crowd/"); t++) await sleep(500);
  step("a card opens the app's crowd page (A8)", String(await path()).startsWith("/crowd/"));

  // Profile setup goes to sign-in, the same place Profile's own button goes.
  await send("Page.navigate", { url: `${SITE}/crowds` });
  await until(HOME_COPY.profileButton);
  await click(HOME_COPY.profileButton);
  for (let t = 0; t < 30 && (await path()) !== "/sign-in"; t++) await sleep(500);
  step("'Set up my profile' opens sign-in", (await path()) === "/sign-in");
  ws.close();
} catch (err) {
  console.log(String(err.message ?? err));
  ok = false;
} finally {
  chrome?.kill();
}
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
