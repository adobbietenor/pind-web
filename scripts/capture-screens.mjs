// Every screen as it is today, captured for the design canvas (Alex, 29 Oct 2026: "capture
// only, no design changes"). Lives on design/screens-current only — never merged.
//
//   node --env-file=.dev.vars scripts/capture-screens.mjs
//
// Real headless Chrome at iPhone size (393×852 CSS px at 3×), driving pind.social the way
// the browser checks do: the Worker's own pages as a stranger, and the app's screens as
// people signed in through the sealed hand-off. Each person is a harness tester (never
// emailed, the photo check skips them) with a drawn portrait — the test crowd's own
// illustrations, visibly not photographs. Every gathering is at the test crowd's venue,
// so it is a seed gathering only testers can see. Everything made is deleted at the end.
//
// Writes screens/<NN>-<screen>-<name>.png (the first 852 px, as the phone shows it) and,
// where the screen is longer, a -full.png of the whole length; then screens/INDEX.md.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Resvg } from "@cf-wasm/resvg/node";
import { seal } from "../src/public/sealed.ts";
import { portraitSvg } from "../src/admin/testcrowd.ts";
import { ALL_TAGS } from "../packages/shared/src/tags.ts";
import { NEIGHBOURHOODS } from "../packages/shared/src/neighbourhoods.ts";
import { QUICKPIN_COPY } from "../packages/shared/src/quickpin.ts";
import { OPTIN_COPY } from "../packages/shared/src/optin.ts";
import { CODE_SENT_TO } from "../packages/shared/src/profile.ts";
import { SOLO_COPY, soloTimes } from "../packages/shared/src/solo.ts";
import { SQUAD_COPY } from "../packages/shared/src/squad.ts";
import { AFTER_COPY, CONNECTIONS_COPY, WOMEN_ONLY_COPY } from "../packages/shared/src/after.ts";
import { CROWD_COPY } from "../packages/shared/src/crowd.ts";
import { ROOM_COPY, GROUP_COPY } from "../packages/shared/src/room.ts";
import { needChrome, needEnv, sessionSecretMatches, testCrowd } from "./fixture.mjs";

needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SESSION_SECRET");
const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
needChrome(CHROME);
await sessionSecretMatches(SITE);

const W = 393, H = 852, DPR = 3;
const OUT = resolve("screens");
const RAW = mkdtempSync(join(tmpdir(), "pind-shots-"));
const PHOTO = resolve("tests/photos/cartoon.jpg");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
const S = { apikey: service, authorization: `Bearer ${service}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rest = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...S, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
const must = async (res, what) => {
  res = await res;
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};
const rpc = (fn, args = {}) => rest(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

// ---------------------------------------------------------------------------------------
// What was captured, and what looked wrong on the way (reported, never fixed here).
const shots = [];
const problems = [];
const note = (s) => { console.log(`  ! ${s}`); problems.push(s); };

// ---------------------------------------------------------------------------------------
// Chrome, one browser context per person (each its own cookies and storage).
const port = 9300 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-cap-"))}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let ver;
for (let i = 0; i < 80 && !ver; i++) { await sleep(250); try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch {} }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const waiting = new Map();
const listeners = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method && m.sessionId && listeners.has(m.sessionId)) listeners.get(m.sessionId).push(m);
});
const cdp = (method, params = {}, sessionId) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });

async function browser({ cookie } = {}) {
  const { result: { browserContextId } } = await cdp("Target.createBrowserContext", { disposeOnDetach: true });
  const { result: { targetId } } = await cdp("Target.createTarget", { url: "about:blank", browserContextId });
  const { result: { sessionId } } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  const events = [];
  listeners.set(sessionId, events);
  const send = async (method, params = {}) => {
    const m = await cdp(method, params, sessionId);
    if (m.error) throw new Error(`${method}: ${m.error.message}`);
    return m.result;
  };
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setUserAgentOverride", { userAgent: UA, platform: "iPhone" });
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.setInterceptFileChooserDialog", { enabled: true });
  if (cookie) await send("Network.setCookie", { name: "pind_pin", value: cookie, domain: new URL(SITE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });

  const page = {
    send, evaluate, events,
    body: async () => String(await evaluate("document.body ? document.body.innerText : ''")),
    path: async () => String(await evaluate("location.pathname")),
    async go(path, text, ms = 25000) {
      await send("Page.navigate", { url: path.startsWith("http") ? path : `${SITE}${path}` });
      await sleep(600);
      return text ? page.until(text, ms) : true;
    },
    async until(text, ms = 20000) {
      const want = Array.isArray(text) ? text : [text];
      for (let t = 0; t < ms; t += 400) {
        const b = await page.body();
        if (want.some((w) => (w instanceof RegExp ? w.test(b) : b.includes(w)))) return true;
        await sleep(400);
      }
      return false;
    },
    click: (text, { last = true } = {}) => evaluate(`(() => { const els=[...document.querySelectorAll('[role=checkbox],[role=switch],[role=button],[role=radio],[role=link],button,a,div')].filter(e=>e.innerText&&e.innerText.trim()===${JSON.stringify(text)}); const e=els[${last ? "els.length-1" : "0"}]; if(!e) return false; e.click(); return true; })()`),
    async type(label, text) {
      const found = await evaluate(`(() => { const ins=[...document.querySelectorAll('input,textarea')]; const want=${JSON.stringify(label)}; const i=ins.find(x=>x.placeholder===want||x.getAttribute('aria-label')===want) || ins.find(x=>{ let n=x; for(let k=0;k<4&&n;k++){ n=n.parentElement; if(n&&n.innerText&&n.innerText.trim().startsWith(want)) return true;} return false; }); if(!i) return false; i.focus(); return true; })()`);
      if (!found) throw new Error(`no field "${label}"`);
      await send("Input.insertText", { text });
      await sleep(200);
    },
    async longPress(text) {
      const r = await evaluate(`(() => { const els=[...document.querySelectorAll('div')].filter(e=>e.innerText&&e.innerText.trim()===${JSON.stringify(text)}); const e=els[els.length-1]; if(!e) return null; e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; })()`);
      if (!r) return false;
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
      await sleep(1100);
      // Cancel, never end: an end lands as a tap on whatever the hold just opened (the first
      // run filed a report on Jonah that way, and a safety report hides a person — H9).
      await send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await sleep(500);
      return true;
    },
    async choosePhoto(button) {
      events.length = 0;
      await page.click(button);
      let chooser;
      for (let t = 0; t < 20 && !chooser; t++) { await sleep(250); chooser = events.find((e) => e.method === "Page.fileChooserOpened"); }
      if (!chooser) return false;
      await send("DOM.setFileInputFiles", { files: [PHOTO], backendNodeId: chooser.params.backendNodeId });
      return true;
    },
    // The capture itself: what the phone shows first, then the whole length if longer.
    async shot(flow, screen, name, state, { wait = 900, full = true, focus = null } = {}) {
      if (focus) await evaluate(`(() => { const want=${JSON.stringify(focus)}; const els=[...document.querySelectorAll('div,span,a,button')].filter(e=>e.innerText&&e.innerText.trim().startsWith(want)); els.sort((a,b)=>a.innerText.length-b.innerText.length); els[0]?.scrollIntoView({block:'center'}); return !!els[0]; })()`);
      await evaluate(`(async()=>{ try { await document.fonts.ready; } catch {} await Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r; setTimeout(r,5000)}))); return true; })()`);
      await sleep(wait);
      const key = `${String(flow).padStart(6, "0")}`;
      const slug = `${screen}-${name}`.replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/-$/, "");
      const first = await send("Page.captureScreenshot", { format: "png" });
      const tmp = join(RAW, `${key}--${slug}.png`);
      writeFileSync(tmp, Buffer.from(first.data, "base64"));
      const entry = { flow, screen, name, state, slug, tmp, full: null, path: await page.path() };
      if (full) {
        const tall = await evaluate(`(() => { let h = document.documentElement.scrollHeight; for (const e of document.querySelectorAll('*')) { const s = getComputedStyle(e); if ((s.overflowY==='auto'||s.overflowY==='scroll') && e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 200) h = Math.max(h, e.scrollHeight - e.clientHeight + innerHeight); } return h; })()`);
        if (tall > H + 24) {
          const h = Math.min(Math.ceil(tall), 12000);
          // Chrome cannot render one capture taller than ~16k device px (past that it tiles),
          // so a very tall page gets its full length at a lower scale, said in the index.
          const scale = Math.min(DPR, Math.floor((16000 / h) * 10) / 10);
          entry.fullScale = scale;
          await send("Emulation.setDeviceMetricsOverride", { width: W, height: h, deviceScaleFactor: scale, mobile: true });
          await sleep(900);
          const all = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          entry.full = join(RAW, `${key}--${slug}-full.png`);
          writeFileSync(entry.full, Buffer.from(all.data, "base64"));
          await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
          await sleep(500);
        }
      }
      shots.push(entry);
      console.log(`  shot ${flow} ${screen} ${name}${entry.full ? " (+full)" : ""}`);
      return entry;
    },
  };
  return page;
}

// A scene never stops the run: its failure is a finding, written down, and the next goes on.
async function scene(title, fn) {
  console.log(`- ${title}`);
  try { await fn(); } catch (err) { note(`${title}: ${String(err.message ?? err).slice(0, 300)}`); }
}
const expect = (ok, what) => { if (!ok) note(what); return ok; };

// ---------------------------------------------------------------------------------------
// The stand-in people. Harness testers with the test crowd's drawn portraits.
const LOOKS = {
  Nora: { bg: "#6b4fa0", skin: "#e8b89a", hair: "#3a2416", style: 2 },
  Theo: { bg: "#2f6f8f", skin: "#c68a64", hair: "#1a1a1a", style: 1 },
  Priya: { bg: "#b0503f", skin: "#9c6a48", hair: "#120c0a", style: 2 },
  Sam: { bg: "#3f7f55", skin: "#f1c7a8", hair: "#c98a3b", style: 1 },
  Jonah: { bg: "#8f6f2f", skin: "#e0a98a", hair: "#5a2d1a", style: 0 },
  Lena: { bg: "#7a4fb0", skin: "#f3cfb3", hair: "#d9a441", style: 2 },
  Omar: { bg: "#3a5a8c", skin: "#a8724e", hair: "#0f0f0f", style: 0 },
  Kit: { bg: "#a0457a", skin: "#f0c4a4", hair: "#7a2f1a", style: 1 },
};
const hood = (i) => NEIGHBOURHOODS[i % NEIGHBOURHOODS.length].slug;
const PEOPLE = {
  Nora: { gender: "woman", hood: hood(3), tags: [0, 12, 20, 25, 7], include: true, instagram: "nora.goes.out" },
  Theo: { gender: "man", hood: hood(5), tags: [3, 12, 22] },
  Priya: { gender: "woman", hood: hood(7), tags: [6, 20, 27], include: true, instagram: "priya.k" },
  Sam: { gender: "nonbinary", hood: hood(9), tags: [1, 16, 0], include: true },
  Jonah: { gender: "man", hood: hood(2), tags: [5, 11, 21] },
  Lena: { gender: "woman", hood: hood(11), tags: [2, 15, 25], include: true },
  Omar: { gender: "man", hood: hood(4), tags: [4, 19, 12] },
  Kit: { gender: "woman", hood: hood(6), tags: [8, 13, 20], include: true },
};
const people = {};
const madeUsers = [];
const madeGatherings = [];
const madeSpots = [];

async function makePerson(label) {
  const spec = PEOPLE[label];
  const email = `pind-capture-${label.toLowerCase()}-${Date.now()}@example.com`;
  const password = randomUUID();
  const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), `user ${label}`);
  madeUsers.push(u.id);
  const path = `${u.id}/portrait.png`;
  const png = new Resvg(portraitSvg(LOOKS[label])).render().asPng();
  await must(await fetch(`${base}/storage/v1/object/photos/${path}`, { method: "POST", headers: { ...S, "content-type": "image/png", "x-upsert": "true" }, body: png }), `portrait ${label}`);
  const [p] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: u.id, first_name: label, photo_path: path, photo_status: "approved", neighbourhood: spec.hood }) }), `person ${label}`);
  await must(await rest("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: p.id, gender: spec.gender, birth_year: 1994, include_in_women_only: spec.gender === "nonbinary" && !!spec.include }) }), `private ${label}`);
  await must(await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: p.id, source: "a26" }) }), "19+");
  await must(await rest("/rest/v1/person_tags", { method: "POST", body: JSON.stringify(spec.tags.map((i, n) => ({ person_id: p.id, tag: ALL_TAGS[i % ALL_TAGS.length].slug, on_list: n < 3 }))) }), `tags ${label}`);
  if (spec.instagram) await must(await rest("/rest/v1/person_handles", { method: "POST", body: JSON.stringify({ person_id: p.id, instagram: spec.instagram }) }), `handle ${label}`);
  await must(await rpc("admin_set_tester", { p_auth_user: u.id, p_on: true, p_actor: "capture-screens", p_note: "design capture" }), "tester");
  const t = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "sign in");
  people[label] = { authId: u.id, personId: p.id, refresh: t.refresh_token, access: t.access_token, email };
}
// As the person, with their own token — the product's own rules decide.
const as = async (label, fn, args) => must(await fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${people[label].access}`, "content-type": "application/json" }, body: JSON.stringify(args) }), `${label} ${fn}`);
const cookieFor = (label) => seal(process.env.SESSION_SECRET, { userId: people[label].authId, refreshToken: people[label].refresh, issuedAt: Date.now() });

const crowd = await testCrowd({ pinnable: false });
async function gathering(name, startsAt) {
  const [g] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name, starts_at: startsAt.toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), `gathering ${name}`);
  madeGatherings.push(g.id);
  g.slug = await must(await rpc("admin_mint_slug", { p_gathering: g.id }), "slug");
  return g;
}
const at7pm = (days) => { const d = new Date(Date.now() + days * 86_400_000); d.setUTCHours(23, 0, 0, 0); return d; };
const pin = (g, label, { open = true, party = 1 } = {}) => must(rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: g.id, person_id: people[label].personId, party_total: party, open_to_meeting: open }) }), `pin ${label}`);
const soloOn = (g, label) => must(rest(`/rest/v1/pins?gathering_id=eq.${g.id}&person_id=eq.${people[label].personId}`, { method: "PATCH", body: JSON.stringify({ solo_opt_in: true, solo_visibility: "everyone" }) }), `${label} 1-on-1 on`);
const roomOf = async (g, label, womenOnly = false) => (await must(await rest(`/rest/v1/room_members?person_id=eq.${people[label].personId}&gathering_id=eq.${g.id}&women_only=eq.${womenOnly}&left_at=is.null&select=room_id`), "room"))[0]?.room_id;
const say = (room, label, text) => must(rest("/rest/v1/room_messages", { method: "POST", body: JSON.stringify({ room_id: room, author_id: people[label].personId, body: text }) }), `${label} says`);
const crewSay = (crew, label, text) => must(rest("/rest/v1/crew_messages", { method: "POST", body: JSON.stringify({ crew_id: crew, author_id: people[label].personId, body: text, kind: "user" }) }), `${label} says in the group`);
const meetTime = (g) => soloTimes(g.starts_at, null).find((t) => Date.parse(t) >= Date.parse(g.starts_at) - 60 * 60_000) ?? soloTimes(g.starts_at, null)[0];
async function squad(g, label, name, { spot, womenOnly = false, approve = true } = {}) {
  const crew = await as(label, "start_squad", { p_gathering: g.id, p_name: name, p_spot: spot ?? null, p_meet_at: meetTime(g), p_women_only: womenOnly });
  if (approve) await must(await rpc("admin_record_squad_name_check", { p_crew: crew, p_name: name, p_outcome: "approved", p_source: "capture-screens" }), "approve the name");
  return crew;
}

// ---------------------------------------------------------------------------------------
let walkerId = null;
let storeUserId = null;
try {
  console.log("Setting up people and gatherings…");
  // The test venue has one curated spot; the design review needs a list, so two more for
  // this run only (removed at the end).
  for (const name of ["Under the big screen, main entrance", "Gate 3 doors"]) {
    const [s] = await must(await rest("/rest/v1/meeting_spots", { method: "POST", body: JSON.stringify({ venue_id: crowd.venue_id, name }) }), "spot");
    madeSpots.push(s.id);
  }
  const spots = await must(await rest(`/rest/v1/meeting_spots?venue_id=eq.${crowd.venue_id}&active=eq.true&select=id,name&order=name`), "spots");
  for (const label of Object.keys(PEOPLE)) await makePerson(label);

  // ===================================================================================
  // 1 — The Worker's public pages, as a stranger.
  const stranger = await browser();
  const realUpcoming = (await must(await rest(`/rest/v1/gatherings?is_seed=eq.false&published_at=not.is.null&withdrawn_at=is.null&starts_at=gt.${new Date(Date.now() + 86_400_000).toISOString()}&select=slug,name,pins(count)&order=starts_at&limit=60`), "real gatherings"));
  const zero = realUpcoming.find((g) => (g.pins?.[0]?.count ?? 0) === 0);
  const ended = (await must(await rest(`/rest/v1/gatherings?is_seed=eq.false&published_at=not.is.null&slug=eq.rebecca-black-exhibitionism-on-tour-oct-21&select=slug`), "ended"))[0]
    ?? (await must(await rest(`/rest/v1/gatherings?is_seed=eq.false&published_at=not.is.null&starts_at=lt.${new Date(Date.now() - 2 * 86_400_000).toISOString()}&select=slug&order=starts_at.desc&limit=1`), "ended"))[0];
  const startedReal = (await must(await rest(`/rest/v1/gatherings?is_seed=eq.false&published_at=not.is.null&withdrawn_at=is.null&starts_at=lt.${new Date().toISOString()}&starts_at=gt.${new Date(Date.now() - 3 * 3_600_000).toISOString()}&select=slug&limit=1`), "started"))[0];

  await scene("W1 the list", async () => {
    await stranger.go("/", "Toronto"); await stranger.shot(100, "W1", "this-weeks-crowds", "events tab, as a stranger");
    await stranger.go("/community"); await stranger.shot(101, "W1", "this-weeks-crowds-community", "community tab");
    await stranger.go("/search"); await stranger.shot(102, "W1", "search", "search, nothing typed");
    await stranger.go("/search?q=raptors"); await stranger.shot(103, "W1", "search-results", "search for 'raptors'");
  });
  await scene("W2 the crowd page before pinning", async () => {
    await stranger.go(`/g/${zero.slug}`); await stranger.shot(110, "W2", "crowd-page", `nobody pinned yet (${zero.name})`);
    if (ended) { await stranger.go(`/g/${ended.slug}`); await stranger.shot(112, "W2", "crowd-page-ended", `a gathering that has finished (${ended.slug})`); }
    await stranger.go(`/g/${crowd.slug}`); await stranger.shot(113, "W2", "crowd-page-not-found", "a link that is not public (the test crowd, to a stranger)");
    await stranger.go("/g/no-such-gathering-oct-01"); await stranger.shot(114, "W2", "crowd-page-unknown-link", "a slug that does not exist");
  });
  await scene("W3 share card", async () => {
    await stranger.go(`/g/${zero.slug}/spot`); await stranger.shot(120, "W3", "share-card", "the /spot card");
    const og = Buffer.from(await (await fetch(`${SITE}/og/${zero.slug}.png`)).arrayBuffer());
    const ogTmp = join(RAW, "og.png"); writeFileSync(ogTmp, og);
    shots.push({ flow: 121, screen: "W4", name: "link-preview-image", state: "the OG image a link unfurls to (the image file itself, not a phone screen)", slug: "W4-link-preview-image", tmp: ogTmp, full: null, path: `/og/${zero.slug}.png` });
  });
  await scene("A26 quick pin, the Worker's", async () => {
    await stranger.go(`/g/${zero.slug}/pin`, QUICKPIN_COPY.nineteen); await stranger.shot(130, "A26", "quick-pin", "empty form, as a stranger");
    await stranger.click(QUICKPIN_COPY.submit);
    await sleep(2500); await stranger.shot(131, "A26", "quick-pin-errors", "submitted empty: the field errors");
    // Pinning closes at the effective end (start + 3 h), so "closed" is a finished gathering.
    if (ended) { await stranger.go(`/g/${ended.slug}/pin`); await stranger.shot(132, "A26", "quick-pin-closed", `a gathering that has finished: pinning closed (${ended.slug})`); }
    if (startedReal) { await stranger.go(`/g/${startedReal.slug}/pin`); await stranger.shot(133, "A26", "quick-pin-started", `a gathering that started under three hours ago: still open (${startedReal.slug})`); }
  });
  await scene("about, privacy, terms", async () => {
    await stranger.go("/about"); await stranger.shot(140, "W4", "about", "about");
    await stranger.go("/privacy"); await stranger.shot(141, "W4", "privacy", "privacy policy");
    await stranger.go("/terms"); await stranger.shot(142, "W4", "terms", "terms");
  });

  // ===================================================================================
  // 2 — The link path: an anonymous tester quick-pins in the app, then A27's steps.
  const GW = await gathering("Leafs vs Bruins", at7pm(4));
  await scene("Link path: A26 in the app → A27 → A9", async () => {
    const signup = await must(await fetch(`${base}/auth/v1/signup`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ data: {} }) }), "anon sign-up");
    walkerId = signup.user.id;
    madeUsers.push(walkerId);
    await must(await rest(`/auth/v1/admin/users/${walkerId}`, { method: "PUT", body: JSON.stringify({ app_metadata: { pind_harness: true } }) }), "mark anon");
    await must(await rpc("admin_add_anonymous_tester", { p_user: walkerId, p_actor: "capture-screens" }), "tester");
    const w = await browser({ cookie: await seal(process.env.SESSION_SECRET, { userId: walkerId, refreshToken: signup.refresh_token, issuedAt: Date.now() }) });
    await w.go(`/crowd/${GW.slug}`, CROWD_COPY.pinIn); await w.shot(200, "A8", "crowd-page-not-pinned", "anonymous, not pinned (app)");
    await w.go(`/pin/${GW.slug}`, QUICKPIN_COPY.meetUp); await w.shot(201, "A26", "quick-pin-app", "empty form, anonymous (app's A26)");
    await w.type(QUICKPIN_COPY.firstName, "Mira");
    await w.click(QUICKPIN_COPY.meetUp); await w.click(QUICKPIN_COPY.nineteen);
    await w.shot(202, "A26", "quick-pin-app-filled", "filled in, 'meet up' ticked");
    await w.click(QUICKPIN_COPY.submit);
    expect(await w.until(QUICKPIN_COPY.nextDetails), "A26 app: 'You're in' never showed");
    await w.shot(203, "A26", "quick-pin-youre-in", "pinned: 'You're in', next a few details");
    await w.go("/crowds", "Toronto"); await w.shot(204, "A5", "home-cities-anonymous", "anonymous pinner: set up profile offer");
    await w.go(`/crowd/${GW.slug}`, CROWD_COPY.openToMeeting); await w.shot(205, "A9", "crowd-page-pinned-not-open", "pinned, not open to meeting (anonymous)");
    await w.go(`/opt-in/${GW.slug}`, "Date of birth"); await w.shot(210, "A27", "opt-in-1-you", "step 1 'you': empty (first name carried)");
    await w.type("Day", "14"); await w.type("Month", "6"); await w.type("Year", "1996");
    await w.click("Woman");
    await sleep(500);
    await w.shot(211, "A27", "opt-in-1-you-women-only-question", "gender picked: the women-only question");
    expect(await w.choosePhoto("Choose a photo"), "A27: the photo picker did not open");
    expect(await w.until("Remove photo"), "A27: the chosen photo never showed");
    await w.shot(212, "A27", "opt-in-1-you-photo-chosen", "filled, photo chosen");
    await w.click("Continue");
    expect(await w.until("Where in the city?"), "A27: 'where' never opened");
    await w.shot(213, "A27", "opt-in-2-where", "step 2 'where': nothing picked");
    await w.click(NEIGHBOURHOODS[1].name); for (const t of ALL_TAGS.slice(0, 3)) await w.click(t.name);
    await w.shot(214, "A27", "opt-in-2-where-picked", "a neighbourhood and three tags picked");
    await w.click("Skip for now");
    expect(await w.until(OPTIN_COPY.contactHeading), "A27: the sign-in step never opened");
    await w.shot(215, "A27", "opt-in-3-sign-in", "step 3 'a way to sign in'");
    const email = `delivered+pind-capture-${Date.now()}@resend.dev`;
    await w.type("Email me a code", email); await w.click("Send the code");
    expect(await w.until(CODE_SENT_TO(email)), "A27: the code step never named the address");
    await w.shot(216, "A27", "opt-in-3-code-sent", "code sent, waiting for the six digits");
    await must(await rest(`/auth/v1/admin/users/${walkerId}`, { method: "PUT", body: JSON.stringify({ email, email_confirm: true }) }), "confirm address");
    await w.evaluate(`(() => { const k=Object.keys(localStorage).find(k=>k.endsWith('-auth-token')); const s=JSON.parse(localStorage.getItem(k)); s.expires_at=0; localStorage.setItem(k, JSON.stringify(s)); })()`);
    await w.send("Page.reload");
    expect(await w.until(OPTIN_COPY.safetyHeading, 25000), "A27: the safety sheet never showed");
    await w.shot(217, "A27", "opt-in-4-safety-sheet", "the safety sheet, before accepting");
    await w.click(OPTIN_COPY.accept); await sleep(300);
    await w.shot(218, "A27", "opt-in-4-safety-sheet-accepted", "terms ticked");
    await w.click(OPTIN_COPY.finish);
    expect(await w.until(ROOM_COPY.firstHeading, 25000), "A9 after A27: 'You're the first here' never showed");
    await w.shot(220, "A9", "crowd-page-open-alone", "open to meeting, the first here");
    await w.go("/me", "Profile"); await w.shot(221, "A21", "profile-with-gaps", "picked a neighbourhood and tags, then Skip: Profile names what's missing");
    await w.go("/my-events"); await sleep(2500); await w.shot(222, "A19", "my-events-one-event-alone", "one event, alone in the room");
  });

  // ===================================================================================
  // 3 — The store path: signed out, then A1 → A2 → A3 for a new account.
  await scene("Store path: A1 sign in", async () => {
    const out = await browser();
    await out.go("/crowds", "Toronto"); await out.shot(300, "A5", "home-cities-signed-out", "signed out");
    await out.go("/my-events"); await sleep(3000); await out.shot(301, "A19", "my-events-signed-out", "signed out");
    await out.go("/me"); await sleep(3000); await out.shot(302, "A21", "profile-signed-out", "signed out");
    await out.go("/sign-in", "Email me a code"); await out.shot(303, "A1", "sign-in", "Apple, Google, email code");
    const email = `delivered+pind-capture-a1-${Date.now()}@resend.dev`;
    await out.type("Email me a code", email); await out.click("Send the code");
    await out.until(CODE_SENT_TO(email)); await out.shot(304, "A1", "sign-in-code-sent", "code sent, waiting for the six digits");
    const made = await must(await rest(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`), "the code's user").catch(() => null);
    const id = made?.users?.find?.((u) => u.email === email)?.id;
    if (id) madeUsers.push(id);
  });
  await scene("Store path: A2 you, A3 where", async () => {
    const email = `pind-capture-store-${Date.now()}@example.com`;
    const password = randomUUID();
    const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), "store user");
    storeUserId = u.id; madeUsers.push(u.id);
    const t = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "sign in");
    const s = await browser({ cookie: await seal(process.env.SESSION_SECRET, { userId: u.id, refreshToken: t.refresh_token, issuedAt: Date.now() }) });
    await s.go("/you", "Date of birth"); await s.shot(310, "A2", "you", "new account: empty");
    await s.type("First name", "Dana").catch(() => undefined);
    await s.type("Day", "3"); await s.type("Month", "2"); await s.type("Year", "2010");
    await sleep(800); await s.shot(311, "A2", "you-under-19", "a date of birth under 19");
    await s.go("/you", "Date of birth");
    await s.type("First name", "Dana").catch(() => undefined);
    await s.type("Day", "3"); await s.type("Month", "2"); await s.type("Year", "1995");
    await s.click("Nonbinary"); await sleep(400);
    expect(await s.choosePhoto("Choose a photo"), "A2: the photo picker did not open");
    await s.until("Remove photo");
    await s.shot(312, "A2", "you-filled", "filled, photo chosen");
    await s.click("Continue");
    expect(await s.until("Where in the city?", 25000), "A2 → A3: 'where' never opened after Continue"); await s.shot(320, "A3", "where", "neighbourhood and tags: nothing picked");
    await s.click(NEIGHBOURHOODS[4].name); for (const t2 of ALL_TAGS.slice(5, 9)) await s.click(t2.name);
    await s.shot(321, "A3", "where-picked", "a neighbourhood and four tags");
    for (let i = 0; i < 12; i++) await s.click(ALL_TAGS[10 + i].name);
    await sleep(500); await s.shot(322, "A3", "where-too-many-tags", "tapping past the limit");
  });

  // ===================================================================================
  // 4 — Nora: home, profile, settings, and the empty states before she has done anything.
  const nora = await browser({ cookie: await cookieFor("Nora") });
  await scene("Nora: empty states", async () => {
    await nora.go("/crowds", "Toronto"); await nora.shot(400, "A5", "home-cities", "signed in");
    await nora.go("/city/toronto"); await sleep(4000); await nora.shot(401, "A6-A7", "city-crowds-this-week", "Toronto's list (real staging gatherings)");
    await nora.go("/my-events"); await sleep(3500); await nora.shot(402, "A19", "my-events-empty", "nothing pinned yet");
    await nora.go("/connections"); await sleep(3500); await nora.shot(403, "A20", "connections-empty", "no connections yet");
  });

  // ===================================================================================
  // 5 — The crowd page around one gathering (GA), three days out.
  const GA = await gathering("Raptors vs Celtics", at7pm(3));
  for (const n of ["Theo", "Priya", "Sam", "Jonah", "Lena"]) await pin(GA, n);
  await pin(GA, "Omar", { open: false });
  await pin(GA, "Kit", { open: false, party: 3 });
  await scene("A8/A9 at a gathering with people", async () => {
    await nora.go(`/crowd/${GA.slug}`, CROWD_COPY.pinIn); await nora.shot(500, "A8", "crowd-page-not-pinned-with-people", "not pinned; others pinned and open");
    await nora.go(`/pin/${GA.slug}`, QUICKPIN_COPY.meetUp); await nora.shot(501, "A26", "quick-pin-app-signed-in", "signed in with a profile (app's A26)");
    await pin(GA, "Nora", { open: false });
    await nora.go(`/crowd/${GA.slug}`, CROWD_COPY.openToMeeting); await nora.shot(502, "A9", "crowd-page-pinned-not-open-with-people", "pinned, not open; others are");
    await nora.go(`/pin/${GA.slug}`, QUICKPIN_COPY.editOrRemove); await nora.shot(503, "A26", "change-or-remove-pin", "already pinned: change or remove");
    await must(rest(`/rest/v1/pins?gathering_id=eq.${GA.id}&person_id=eq.${people.Nora.personId}`, { method: "PATCH", body: JSON.stringify({ open_to_meeting: true }) }), "Nora opens");
    await nora.go(`/crowd/${GA.slug}`, CROWD_COPY.listHeading); await nora.shot(505, "A9", "crowd-page-open-with-people", "open to meeting, five others, no squads yet, 1-on-1 off");
  });

  // The room.
  let roomA;
  await scene("A10 the room", async () => {
    roomA = await roomOf(GA, "Nora");
    await nora.go(`/room/${roomA}`, ROOM_COPY.placeholder); await nora.shot(600, "A10", "room-arrivals", "six in the room, nobody has said anything (cards fold at five)");
    await say(roomA, "Theo", "Anyone grabbing a drink before tip-off?");
    await say(roomA, "Priya", "Yes! I'll be near the main entrance from 6.");
    await say(roomA, "Sam", "First Raptors game in years, very excited");
    await say(roomA, "Jonah", "Section 112 if anyone's close by");
    await say(roomA, "Nora", "I'm in — first time using this, hi all 👋");
    await say(roomA, "Lena", "Hi Nora! Come find us at the entrance");
    await nora.go(`/room/${roomA}`, "Come find us"); await nora.shot(601, "A10", "room-conversation", "a conversation going");
    await nora.click("Say something to the room").catch(() => undefined);
    if (await nora.longPress("Section 112 if anyone's close by")) await nora.shot(602, "A10", "room-hold-someone-elses-message", "long-press someone else's message: report them", { full: false });
    else note("A10: could not long-press a message to open the report sheet");
    await nora.go(`/room/${roomA}`, "Come find us");
    if (await nora.longPress("I'm in — first time using this, hi all 👋")) await nora.shot(603, "A10", "room-hold-own-message", "long-press your own message: delete", { full: false });
  });
  const GT = await gathering("Indie night at the Horseshoe", at7pm(6));
  await scene("A10 the room with two (the first arrival)", async () => {
    await pin(GT, "Theo"); await pin(GT, "Nora");
    const r = await roomOf(GT, "Nora");
    await nora.go(`/crowd/${GT.slug}`, ROOM_COPY.inRoom(2)); await nora.shot(610, "A9", "crowd-page-open-two-in-room", "two in the room");
    await nora.go(`/room/${r}`, ROOM_COPY.placeholder); await nora.shot(611, "A10", "room-two", "the room at two: one arrival card, openers");
    await pin(GT, "Priya");
    await nora.go(`/room/${r}`, ROOM_COPY.placeholder); await sleep(1500); await nora.shot(612, "A10", "room-three-enough-to-go", "the room at three: 'enough to go together'");
  });

  // Squads.
  let theoSquad, noraSquad;
  await scene("A15/A11 squads", async () => {
    await nora.go(`/crowd/${GA.slug}`, SQUAD_COPY.none); await nora.shot(700, "A15", "squads-none", "no squads yet (crowd page)");
    await nora.click(SQUAD_COPY.start); await nora.until(SQUAD_COPY.nameLabel);
    await nora.shot(701, "A15", "start-squad-sheet", "the start sheet, empty");
    await nora.type(SQUAD_COPY.namePlaceholder, "Drinks before tip-off");
    await nora.click(spots[0].name);
    await nora.evaluate(`(() => { const t=[...document.querySelectorAll('[role=radio]')].find(e=>/[ap]\.m\./.test(e.innerText)); t?.click(); return !!t; })()`);
    await sleep(300);
    await nora.shot(702, "A15", "start-squad-sheet-filled", "named, a spot picked");
    await nora.click("Cancel");
    noraSquad = await squad(GA, "Nora", "Nora's pre-game crew", { spot: spots[0].id, approve: false });
    await nora.go(`/crowd/${GA.slug}`, SQUAD_COPY.heading); await nora.shot(703, "A11", "squad-card-name-checking", "your squad on the crowd page: name being checked");
    await nora.go(`/group/${noraSquad}`); await sleep(2500); await nora.shot(704, "A11", "squad-name-checking", "your squad, just you, name being checked");
    await must(await rpc("admin_record_squad_name_check", { p_crew: noraSquad, p_name: "Nora's pre-game crew", p_outcome: "rejected", p_source: "capture-screens" }), "reject");
    await nora.go(`/group/${noraSquad}`); await sleep(2500); await nora.shot(705, "A11", "squad-name-rejected", "the name was refused: pick another");
    await as("Nora", "leave_group", { p_crew: noraSquad });
    theoSquad = await squad(GA, "Theo", "Drinks at the Dog & Bear", { spot: spots[1].id });
    await as("Priya", "join_squad", { p_crew: theoSquad });
    await squad(GA, "Lena", "Women's pre-game", { spot: spots[0].id, womenOnly: true });
    await squad(GA, "Jonah", "Section 112 meetup", { spot: spots[2].id });
    await nora.go(`/crowd/${GA.slug}`, "Drinks at the Dog & Bear"); await nora.shot(707, "A15", "squads-list", "three squads to join (one women only)");
    await nora.click(SQUAD_COPY.join, { last: false }); await sleep(2500);
    await nora.go(`/crowd/${GA.slug}`, SQUAD_COPY.heading); await nora.shot(708, "A11", "squad-card-joined", "your squad on the crowd page");
    await crewSay(theoSquad, "Theo", "Welcome both! I'll grab a table around 6");
    await crewSay(theoSquad, "Priya", "Perfect, I'll be there by 6:15");
    await crewSay(theoSquad, "Nora", "See you there 🙌");
    await nora.go(`/group/${theoSquad}`, "See you there"); await nora.shot(709, "A11", "squad-with-chat", "three of you, the plan and the chat");
  });

  // 1-on-1 at its own gathering (one group a gathering).
  const GS = await gathering("Toronto FC v Montréal", at7pm(5));
  for (const n of ["Theo", "Priya", "Sam", "Lena", "Nora"]) await pin(GS, n);
  for (const n of ["Theo", "Priya", "Sam", "Lena"]) await soloOn(GS, n);
  let pairCrew;
  await scene("A28/A29 1-on-1", async () => {
    await nora.go(`/crowd/${GS.slug}`, SOLO_COPY.label); await nora.shot(800, "A28", "one-on-one-off", "crowd page: 1-on-1 not turned on");
    await nora.click(SOLO_COPY.label); await nora.until(SOLO_COPY.turnOn);
    await nora.shot(801, "A28", "one-on-one-sheet", "the opt-in sheet", { full: false });
    await nora.click(SOLO_COPY.everyone); await sleep(300);
    await nora.shot(802, "A28", "one-on-one-sheet-chosen", "'everyone who opted in' chosen", { full: false });
    await nora.click(SOLO_COPY.turnOn);
    expect(await nora.until(SOLO_COPY.letsMeetUp), "A29: 'Let's meet up!' never showed after turning on");
    await nora.shot(803, "A29", "one-on-one-list", "on: four people with 'Let's meet up!'");
    await nora.click(SOLO_COPY.letsMeetUp, { last: false });
    await nora.until(SOLO_COPY.sent); await nora.shot(804, "A29", "one-on-one-invite-sent", "an invite sent");
    const [inv] = await must(await rest(`/rest/v1/solo_proposals?gathering_id=eq.${GS.id}&to_person=eq.${people.Nora.personId}&select=id`), "none yet");
    if (!inv) await as("Priya", "propose_solo", { p_gathering: GS.id, p_to: people.Nora.personId, p_spot: null, p_meet_at: null, p_line: null });
    await nora.go(`/crowd/${GS.slug}`, SOLO_COPY.invited); await nora.shot(805, "A29", "one-on-one-invite-received", "Priya wants to meet up");
    await nora.click(SOLO_COPY.accept);
    await nora.until(SOLO_COPY.pairHeading("Priya")); await nora.shot(806, "A29", "one-on-one-pair-card", "you and Priya are meeting up (crowd page)");
    pairCrew = (await must(await rest(`/rest/v1/crew_members?person_id=eq.${people.Nora.personId}&gathering_id=eq.${GS.id}&left_at=is.null&select=crew_id`), "pair"))[0]?.crew_id;
    await crewSay(pairCrew, "Priya", "Hi! Glad you said yes 😊");
    await crewSay(pairCrew, "Nora", "Hey Priya! Where are you sitting?");
    await nora.go(`/group/${pairCrew}`, SOLO_COPY.pairPick); await nora.shot(807, "A29", "pair-pick-a-spot", "the pair, no spot yet");
    await nora.click(SOLO_COPY.pairSuggest); await nora.until(SOLO_COPY.pairSend);
    await nora.shot(808, "A29", "pair-suggest-a-spot", "suggesting: spots and times as chips", { focus: SOLO_COPY.pairPick });
    await nora.evaluate(`(() => { const r=[...document.querySelectorAll('[role=radio]')]; r[1]?.click(); r[${spots.length + 2}]?.click(); return true; })()`);
    await sleep(400); await nora.shot(809, "A29", "pair-suggest-picked", "a spot and a time picked", { focus: SOLO_COPY.pairPick });
    await nora.click(SOLO_COPY.pairSend);
    await nora.until("It's Priya's to say yes to"); await nora.shot(810, "A29", "pair-suggested-waiting", "your suggestion, waiting for Priya");
    await as("Priya", "suggest_solo_spot", { p_crew: pairCrew, p_spot: spots[2].id, p_meet_at: meetTime(GS) });
    await nora.go(`/group/${pairCrew}`, SOLO_COPY.pairConfirm); await nora.shot(811, "A29", "pair-their-suggestion", "Priya suggested another: Sounds good?");
    await nora.click(SOLO_COPY.pairConfirm);
    await nora.until(SOLO_COPY.planHeading("Priya")); await sleep(1500); await nora.shot(812, "A29", "one-on-one-plan", "it's a plan: spot and time set");
    await nora.go(`/crowd/${GS.slug}`, SOLO_COPY.planHeading("Priya")); await nora.shot(813, "A29", "one-on-one-plan-card", "the plan on the crowd page");
  });

  // Tonight: a squad on the night, "I'm here".
  const GN = await gathering("Marlies vs Bears", at7pm(3));
  await scene("A12/A13 the night", async () => {
    for (const n of ["Nora", "Theo", "Sam", "Omar"]) await pin(GN, n);
    const crew = await squad(GN, "Sam", "Front row crew", { spot: spots[1].id });
    for (const n of ["Nora", "Theo", "Omar"]) await as(n, "join_squad", { p_crew: crew });
    await crewSay(crew, "Sam", "Doors at 6:30, see you all at Gate 3");
    const start = new Date(Date.now() + 2 * 3_600_000);
    await must(rest(`/rest/v1/gatherings?id=eq.${GN.id}`, { method: "PATCH", body: JSON.stringify({ starts_at: start.toISOString() }) }), "tonight");
    const meet = new Date(Math.ceil((Date.now() + 75 * 60_000) / 900_000) * 900_000);
    await must(rest(`/rest/v1/crews?id=eq.${crew}`, { method: "PATCH", body: JSON.stringify({ meet_at: meet.toISOString() }) }), "the squad's time");
    await must(await rpc("admin_groups_tick"), "tick");
    const [{ state }] = await must(await rest(`/rest/v1/crews?id=eq.${crew}&select=state`), "state");
    console.log(`    the night's squad is ${state}`);
    await nora.go(`/group/${crew}`); await sleep(3000); await nora.shot(900, "A12", "squad-tonight", `the squad on the night (state ${state}), before anyone is here`);
    await must(rest(`/rest/v1/crew_members?crew_id=eq.${crew}&person_id=eq.${people.Sam.personId}`, { method: "PATCH", body: JSON.stringify({ arrived_at: new Date().toISOString(), arrival_note: "Blue Raptors cap, by the doors" }) }), "Sam here");
    await must(rest(`/rest/v1/crew_members?crew_id=eq.${crew}&person_id=eq.${people.Theo.personId}`, { method: "PATCH", body: JSON.stringify({ arrived_at: new Date().toISOString(), arrival_note: "Green jacket" }) }), "Theo here");
    await nora.go(`/group/${crew}`, "Blue Raptors cap"); await nora.shot(901, "A13", "squad-im-here", "two said they're here; 'I'm here' for you");
    await nora.go(`/crowd/${GN.slug}`); await sleep(3000); await nora.shot(902, "A9", "crowd-page-tonight", "the crowd page on the night");
  });

  // After the night: a squad that met yesterday evening.
  const GP = await gathering("Comedy night at the Rivoli", at7pm(3));
  let doneCrew;
  await scene("A17/A16 after the night", async () => {
    for (const n of ["Nora", "Theo", "Priya", "Sam"]) await pin(GP, n);
    const room = await roomOf(GP, "Nora");
    await say(room, "Theo", "That was so much fun, thanks all");
    await say(room, "Nora", "Same! Let's do it again");
    doneCrew = await squad(GP, "Priya", "Comedy squad", { spot: spots[0].id });
    for (const n of ["Nora", "Theo", "Sam"]) await as(n, "join_squad", { p_crew: doneCrew });
    await crewSay(doneCrew, "Priya", "Thanks for coming everyone!");
    const past = new Date(Date.now() - 20 * 3_600_000);
    await must(rest(`/rest/v1/gatherings?id=eq.${GP.id}`, { method: "PATCH", body: JSON.stringify({ starts_at: past.toISOString() }) }), "the night");
    await must(rest(`/rest/v1/crews?id=eq.${doneCrew}`, { method: "PATCH", body: JSON.stringify({ meet_at: past.toISOString() }) }), "the squad's time");
    for (const n of ["Priya", "Theo"]) await must(rest(`/rest/v1/crew_members?crew_id=eq.${doneCrew}&person_id=eq.${people[n].personId}`, { method: "PATCH", body: JSON.stringify({ arrived_at: past.toISOString(), arrival_note: "By the bar" }) }), "arrived");
    await must(await rpc("admin_groups_tick"), "tick");
    await nora.go(`/crowd/${GP.slug}`); await sleep(3500); await nora.shot(1000, "A9", "crowd-page-ended", "ended last night (the last 24 hours)");
    await nora.go(`/group/${doneCrew}`, AFTER_COPY.howDidItGo); await nora.shot(1001, "A17", "squad-done", "finished, counted, 'Who did you meet?'");
    await nora.go(`/room/${room}`); await sleep(3000); await nora.shot(1002, "A10", "room-after-the-night", "the room the day after (still writable)");
    await nora.go(`/after/${GP.slug}`, AFTER_COPY.whoDidYouMeet); await nora.shot(1010, "A16", "after-the-night", "who did you meet: nothing ticked");
    await as("Nora", "after_tick", { p_crew: doneCrew, p_to: people.Theo.personId, p_kind: "we_met", p_on: true });
    await as("Nora", "after_tick", { p_crew: doneCrew, p_to: people.Priya.personId, p_kind: "we_met", p_on: true });
    await nora.go(`/after/${GP.slug}`, AFTER_COPY.ticked); await nora.shot(1011, "A16", "after-ticked", "ticked two; they don't know yet");
    await as("Theo", "after_tick", { p_crew: doneCrew, p_to: people.Nora.personId, p_kind: "we_met", p_on: true });
    await nora.go(`/after/${GP.slug}`, AFTER_COPY.keepInTouch); await nora.shot(1012, "A16", "after-matched", "Theo ticked back: 'You met', keep in touch");
    await as("Nora", "after_tick", { p_crew: doneCrew, p_to: people.Theo.personId, p_kind: "keep_in_touch", p_on: true });
    await nora.go(`/after/${GP.slug}`, AFTER_COPY.keepTicked); await nora.shot(1013, "A16", "after-keep-asked", "asked to keep in touch");
    await as("Theo", "after_tick", { p_crew: doneCrew, p_to: people.Nora.personId, p_kind: "keep_in_touch", p_on: true });
    await nora.go(`/after/${GP.slug}`, AFTER_COPY.connected); await nora.shot(1014, "A16", "after-connected", "connected with Theo; the question below");
    await nora.click("No"); await sleep(500); await nora.shot(1015, "A16", "after-question-picked", "an answer picked, comment box", { focus: AFTER_COPY.commentLabel });
    await nora.click(AFTER_COPY.send); await nora.until(AFTER_COPY.thanks); await nora.shot(1016, "A16", "after-question-sent", "answer sent: thank you", { focus: AFTER_COPY.thanks });
  });
  const GO = await gathering("Open mic at the Cameron", at7pm(8));
  await pin(GO, "Nora");
  await scene("A20 connections", async () => {
    await nora.go("/connections", "Theo"); await nora.shot(1100, "A20", "connections", "one connection, met at the comedy night");
    await nora.click(CONNECTIONS_COPY.invite); await sleep(1500); await nora.shot(1101, "A20", "connections-invite", "invite Theo to something you're going to");
  });

  // A room that closed: ended three days ago.
  const GH = await gathering("Jazz at the Rex", at7pm(3));
  await scene("Read-only after 24 hours", async () => {
    for (const n of ["Nora", "Lena", "Kit"]) await pin(GH, n);
    const room = await roomOf(GH, "Nora");
    await say(room, "Lena", "Anyone else at the front table?");
    await say(room, "Nora", "On my way!");
    const past = new Date(Date.now() - 3 * 86_400_000);
    await must(rest(`/rest/v1/gatherings?id=eq.${GH.id}`, { method: "PATCH", body: JSON.stringify({ starts_at: past.toISOString() }) }), "the night");
    await must(await rpc("admin_groups_tick"), "tick");
    await nora.go(`/room/${room}`); await sleep(3000); await nora.shot(1200, "A10", "room-read-only", "three days after: read-only");
    await nora.go(`/crowd/${GH.slug}`); await sleep(3000); await nora.shot(1201, "A9", "crowd-page-ended-days-ago", "ended three days ago");
  });

  // ===================================================================================
  // 6 — With everything in place: My Events, Profile, A22.
  await scene("A19 My Events, full", async () => {
    await nora.go("/my-events"); await sleep(4500); await nora.shot(1400, "A19", "my-events", "tonight on top, upcoming events with their chats, past folded");
    const opened = await nora.click("Past events") || await nora.evaluate(`(() => { const e=[...document.querySelectorAll('[role=button]')].find(x=>/^Past/.test(x.innerText.trim())); if(!e) return false; e.click(); return true; })()`);
    if (opened) { await sleep(1200); await nora.shot(1401, "A19", "my-events-past-open", "past events unfolded", { focus: "Past events" }); }
    else note("A19: could not find the past-events fold to open it");
  });
  await scene("A21 profile and its editors", async () => {
    await nora.go("/me", "Nora"); await sleep(1500); await nora.shot(1500, "A21", "profile", "complete profile, Instagram set");
    await nora.go("/photo"); await sleep(3000); await nora.shot(1501, "A21", "profile-change-photo", "change photo");
    await nora.go("/tags"); await sleep(3000); await nora.shot(1502, "A21", "profile-edit-tags", "edit tags");
    await nora.go("/neighbourhood"); await sleep(3000); await nora.shot(1503, "A21", "profile-neighbourhood", "neighbourhood");
    await nora.go(`/person/${people.Theo.personId}`, "Theo"); await sleep(1500); await nora.shot(1510, "A22", "someone-elses-profile", "Theo: connected, going to the same things");
    await nora.go(`/person/${people.Jonah.personId}`); await sleep(3000); await nora.shot(1511, "A22", "someone-elses-profile-less-shared", "Jonah: one shared gathering");
    await nora.go("/settings"); await sleep(3000);
    await nora.shot(1519, "A23", "settings", "settings: notifications, women-only rooms, export, delete");
    await nora.click("Delete my account"); await sleep(800); await nora.shot(1520, "A23", "settings-delete-confirm", "delete my account: the confirm", { focus: "Yes, delete everything" });
  });

  // Last, because switching it on takes Nora out of her mixed squads (M4.2, by design).
  // Women-only room: Nora switches "women-only rooms only" on, at a gathering of her own.
  const GWO = await gathering("Book club at Another Story", at7pm(7));
  await scene("Women-only room", async () => {
    await as("Nora", "set_women_only_rooms", { p_on: true });
    for (const n of ["Nora", "Priya", "Lena", "Kit", "Theo"]) await pin(GWO, n);
    const wo = await roomOf(GWO, "Nora", true);
    if (!wo) { note("women-only: Nora was not placed in a women-only room"); return; }
    await say(wo, "Kit", "Hi all! I'll bring snacks");
    await nora.go(`/room/${wo}`, "bring snacks"); await nora.shot(1301, "A10", "room-women-only", "the women-only room, with Leave");
    await nora.click(WOMEN_ONLY_COPY.leave); await sleep(800); await nora.shot(1302, "A10", "room-women-only-leave-confirm", "leave the women-only room?", { focus: WOMEN_ONLY_COPY.stay });
    await nora.go(`/crowd/${GWO.slug}`); await sleep(3000); await nora.shot(1303, "A9", "crowd-page-women-only", "crowd page in women-only mode");
    await nora.go("/settings"); await sleep(3000); await nora.shot(1304, "A23", "settings-women-only-on", "women-only rooms only: on");
    await as("Nora", "set_women_only_rooms", { p_on: false }).catch(() => undefined);
  });

} catch (err) {
  note(`run stopped: ${String(err.message ?? err)}`);
} finally {
  // -------------------------------------------------------------------------------------
  // Clean up everything this made.
  console.log("Cleaning up…");
  try { ws.close(); } catch {}
  chrome.kill();
  for (const g of madeGatherings) {
    const crews = await (await rest(`/rest/v1/crews?gathering_id=eq.${g}&select=id`)).json().catch(() => []);
    for (const c of Array.isArray(crews) ? crews : []) {
      await rest(`/rest/v1/notifications?crew_id=eq.${c.id}`, { method: "DELETE" });
      await rest(`/rest/v1/confirmations?crew_id=eq.${c.id}`, { method: "DELETE" });
      await rest(`/rest/v1/solo_spot_suggestions?crew_id=eq.${c.id}`, { method: "DELETE" });
    }
    await rest(`/rest/v1/solo_proposals?gathering_id=eq.${g}`, { method: "DELETE" });
    await rest(`/rest/v1/survey_responses?gathering_id=eq.${g}`, { method: "DELETE" });
    await rest(`/rest/v1/crews?gathering_id=eq.${g}`, { method: "DELETE" });
  }
  // The A1 code made an account for its address; find it by the address.
  const listed = await (await rest("/auth/v1/admin/users?per_page=1000")).json().catch(() => ({}));
  for (const u of listed?.users ?? []) if (/pind-capture/.test(u.email ?? "") && !madeUsers.includes(u.id)) madeUsers.push(u.id);
  const ids = [...madeUsers];
  for (const id of ids) {
    const [person] = await (await rest(`/rest/v1/people?auth_user_id=eq.${id}&select=id`)).json().catch(() => []);
    if (person?.id) {
      await rest(`/rest/v1/notifications?person_id=eq.${person.id}`, { method: "DELETE" });
      await rest(`/rest/v1/account_merges?person_id=eq.${person.id}`, { method: "DELETE" });
      await rest(`/rest/v1/connections?or=(person_a.eq.${person.id},person_b.eq.${person.id})`, { method: "DELETE" });
    }
    const files = await (await fetch(`${base}/storage/v1/object/list/photos`, { method: "POST", headers: { ...S, "content-type": "application/json" }, body: JSON.stringify({ prefix: `${id}/`, limit: 100 }) })).json().catch(() => []);
    const paths = (Array.isArray(files) ? files : []).filter((f) => f.id).map((f) => `${id}/${f.name}`);
    if (paths.length) await fetch(`${base}/storage/v1/object/photos`, { method: "DELETE", headers: { ...S, "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
    await rpc("admin_set_tester", { p_auth_user: id, p_on: false, p_actor: "capture-screens" }).catch(() => undefined);
    await rest(`/rest/v1/people?auth_user_id=eq.${id}`, { method: "DELETE" });
    await rest(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  }
  for (const g of madeGatherings) {
    const res = await rest(`/rest/v1/gatherings?id=eq.${g}`, { method: "DELETE" });
    if (!res.ok) note(`cleanup: gathering ${g} not deleted (${res.status} ${(await res.text()).slice(0, 160)})`);
  }
  for (const s of madeSpots) {
    await rest(`/rest/v1/gathering_spots?spot_id=eq.${s}`, { method: "DELETE" });
    const res = await rest(`/rest/v1/meeting_spots?id=eq.${s}`, { method: "DELETE" });
    if (!res.ok) { await rest(`/rest/v1/meeting_spots?id=eq.${s}`, { method: "PATCH", body: JSON.stringify({ active: false }) }); note(`cleanup: spot ${s} could not be deleted, deactivated instead`); }
  }
}

// ---------------------------------------------------------------------------------------
// Files in flow order, and the index.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
shots.sort((a, b) => a.flow - b.flow);
const width = String(shots.length).length < 2 ? 2 : String(shots.length).length;
const rows = [];
shots.forEach((s, i) => {
  const n = String(i + 1).padStart(width, "0");
  const file = `${n}-${s.slug}.png`;
  writeFileSync(join(OUT, file), readFileSync(s.tmp));
  let fullFile = "";
  if (s.full) { fullFile = `${n}-${s.slug}-full.png`; writeFileSync(join(OUT, fullFile), readFileSync(s.full)); }
  rows.push(`| ${n} | ${s.screen} | ${s.name.replace(/-/g, " ")} | ${s.state} | [${file}](${file})${fullFile ? ` · [full length](${fullFile})${s.fullScale < DPR ? ` (at ${s.fullScale}×)` : ""}` : ""} | \`${s.path}\` |`);
});
writeFileSync(join(OUT, "INDEX.md"), [
  "# Pin'd — every screen as it is (captured " + new Date().toISOString().slice(0, 10) + ")",
  "",
  `iPhone size: ${W}×${H} CSS px at ${DPR}× (${W * DPR}×${H * DPR} px), real headless Chrome with an iPhone Safari user agent, against ${SITE}.`,
  "Each PNG is what the phone shows first; where the screen is longer, a *full length* capture sits beside it.",
  "People are stand-ins (harness testers with drawn portraits) at seed gatherings only testers can see; the Worker's pages use real staging gatherings.",
  "Regenerate with `node --env-file=.dev.vars scripts/capture-screens.mjs` (this branch only).",
  "",
  "| # | Screen | Name | State | File | Path |",
  "|---|---|---|---|---|---|",
  ...rows,
  "",
].join("\n"));
writeFileSync(join(OUT, "problems.txt"), problems.join("\n") + "\n");
console.log(`\n${shots.length} screens (${shots.filter((s) => s.full).length} with a full length) → screens/`);
if (problems.length) { console.log(`${problems.length} things to look at:`); for (const p of problems) console.log(`  - ${p}`); }
process.exit(0);
