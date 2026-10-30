// The Community tab (M4.4), in real headless Chrome as a phone, the way the other checks
// walk their pages:
//
//   - /community loads, shows cards, and loads nothing from another origin;
//   - every card on it is a Community-tab gathering, and none of them is on Events (/);
//   - the licence line is on the page exactly when a City of Toronto listing is;
//   - in the next 30 days no venue and no organiser has more than its weekly cap on the tab.
//
// The tab, the source and the organiser of each card are read from the database by slug,
// with the service key — this is a check, not a visitor.
//
//   npm run check:community
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CITY_ATTRIBUTION } from "../packages/shared/src/constants.ts";
import { needChrome, needEnv } from "./fixture.mjs";

needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
needChrome(CHROME);
const SHOT = process.env.SHOT; // optional: where to save a screenshot of the tab
const TZ = "America/Toronto";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const step = (name, pass, detail = "") => {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) ok = false;
};

const db = createClient(process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, ""), process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function walk(chrome, port, url) {
  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    await sleep(250);
    try {
      const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
      if (p) ws = new WebSocket(p.webSocketDebuggerUrl);
    } catch {}
  }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0;
  const wait = new Map();
  const requests = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id));
    if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send("Network.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
  await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
  await send("Page.navigate", { url });
  for (let t = 0; t < 40 && (await evaluate("document.readyState")) !== "complete"; t++) await sleep(250);
  await sleep(800);
  const page = await evaluate(`({
    slugs: [...document.querySelectorAll('a.card')].map(a => (a.getAttribute('href') || '').replace(/^\\/g\\//, '')),
    footer: document.querySelector('footer')?.innerText ?? '',
    heading: document.querySelector('h1')?.innerText ?? '',
  })`);
  let shot = null;
  if (SHOT) {
    const h = await evaluate("document.documentElement.scrollHeight");
    await send("Emulation.setDeviceMetricsOverride", { width: 393, height: Math.min(h, 5000), deviceScaleFactor: 2, mobile: true });
    await sleep(400);
    shot = (await send("Page.captureScreenshot", { format: "png" })).result.data;
  }
  ws.close();
  return { ...page, requests, shot };
}

let chrome;
try {
  const port = 9600 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-community-"))}`, "about:blank"], { stdio: "ignore" });

  const community = await walk(chrome, port, `${SITE}/community?x=${Date.now()}`);
  if (community.shot) writeFileSync(SHOT, Buffer.from(community.shot, "base64"));
  step("/community loads with its heading", community.heading.includes("Community"), community.heading);
  step("it shows cards", community.slugs.length > 0, `${community.slugs.length} this week`);
  const foreign = community.requests.filter((u) => !u.startsWith(SITE) && !u.startsWith("data:"));
  step("everything it loads comes from our own origin", foreign.length === 0, foreign.slice(0, 3).join(" "));

  const { data: rows, error } = await db.from("gatherings").select("slug, source, tab, organiser").in("slug", community.slugs);
  if (error) throw new Error(error.message);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  step("every card is a Community-tab gathering", community.slugs.every((s) => bySlug.get(s)?.tab === "community"));
  const sources = rows.reduce((m, r) => ((m[r.source] = (m[r.source] ?? 0) + 1), m), {});
  console.log(`     this week by source: ${JSON.stringify(sources)}`);
  const hasCity = rows.some((r) => r.source === "city");
  step("the licence line is there exactly when a City listing is", community.footer.includes(CITY_ATTRIBUTION.text) === hasCity, hasCity ? "City listings shown" : "no City listings shown");

  const events = await walk(chrome, port, `${SITE}/?x=${Date.now()}`);
  const overlap = events.slugs.filter((s) => community.slugs.includes(s));
  step("none of them is on the Events tab", overlap.length === 0, overlap.join(" "));

  // The caps, over the next 30 days, on what a reader can reach.
  const { data: city } = await db.from("cities").select("community_max_per_venue_weekly, community_max_per_organiser_weekly").eq("slug", "toronto").single();
  const now = new Date();
  const { data: ahead, error: e2 } = await db
    .from("gatherings")
    .select("starts_at, venue_id, organiser, venues!inner(name, city)")
    .eq("status", "published")
    .eq("tab", "community")
    .eq("is_seed", false)
    .eq("venues.city", "toronto")
    .gte("starts_at", now.toISOString())
    .lt("starts_at", new Date(now.getTime() + 30 * 864e5).toISOString());
  if (e2) throw new Error(e2.message);
  const weekOf = (iso) => {
    const d = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso)) + "T00:00:00Z");
    return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
  };
  const over = (key, cap) => {
    const m = {};
    for (const g of ahead) {
      const k = key(g);
      if (k) m[`${weekOf(g.starts_at)} ${k}`] = (m[`${weekOf(g.starts_at)} ${k}`] ?? 0) + 1;
    }
    return Object.entries(m).filter(([, n]) => n > cap);
  };
  const venues = over((g) => g.venues.name, city.community_max_per_venue_weekly);
  const orgs = over((g) => g.organiser, city.community_max_per_organiser_weekly);
  step(`no venue over ${city.community_max_per_venue_weekly} a week in the next 30 days`, venues.length === 0, venues.map(([k, n]) => `${k}: ${n}`).join("; "));
  step(`no organiser over ${city.community_max_per_organiser_weekly} a week in the next 30 days`, orgs.length === 0, orgs.map(([k, n]) => `${k}: ${n}`).join("; "));
} catch (err) {
  console.log(`FAIL ${err instanceof Error ? err.message : err}`);
  ok = false;
} finally {
  chrome?.kill();
}
process.exit(ok ? 0 : 1);
