// Screenshots of the opted-in screens (A9 open, A10 the room, A19 My Events) as a real
// signed-in tester, for UI pass 1's comparisons with its mockups (055, 057, 107). Not a
// pass/fail check. It makes its own gathering at the test crowd's venue (testers only),
// four harness people who opt in, a short conversation, then shoots and removes it all.
//
//   node --env-file=.dev.vars scripts/ui-shots-room.mjs <out-dir> [count=4] [women]
//
// "women" makes everyone a woman, so the women-only room opens beside the main one, and
// shoots the crowd page's second card, that room and Settings (105, 103, 106).
//
// KEYBOARD=1 (UI pass 1, round 2) stands in a phone's keyboard the way iOS Safari has one:
// the window keeps its height and the visual viewport loses the keyboard's (336 px). It then
// measures, rather than shoots only: in the room and the squad, the newest message sits over
// the box and the box over the keyboard, before and after typing; in the squad form, each
// field typed in is above the keyboard. Each prints "KB ok" or "KB FAIL", and a FAIL exits 1.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { needChrome, needEnv, testCrowd } from "./fixture.mjs";
import { squadTimes } from "../packages/shared/src/squad.ts";

needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY");
const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
needChrome(CHROME);
const out = process.argv[2];
if (!out) throw new Error("usage: ui-shots-room.mjs <out-dir> [count]");
mkdirSync(out, { recursive: true });
const COUNT = Number(process.argv[3] || 4);
const WOMEN = process.argv[4] === "women";
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const ref = new URL(base).hostname.split(".")[0];
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
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const NAMES = ["Ari", "Priya", "Dev", "Sam", "Maya", "Jon", "Lee", "Kit"].slice(0, COUNT);
const HOODS = ["leslieville", "the-annex", "junction", "parkdale"];
const TAGS = ["chatty", "live-music", "comedy"];

const crowd = await testCrowd({ pinnable: false });
const people = {};
let gathering = null;
let chrome;

async function person(label, i) {
  const email = `pind-uishots-${label.toLowerCase()}-${Date.now()}@example.com`;
  const password = randomUUID();
  const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), `user ${label}`);
  const photo = `${u.id}/face-${Date.now()}.png`;
  await must(await fetch(`${base}/storage/v1/object/photos/${photo}`, { method: "POST", headers: { ...S, "content-type": "image/png" }, body: PNG }), `photo ${label}`);
  const [p] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: u.id, first_name: label, photo_path: photo, neighbourhood: HOODS[i % HOODS.length] }) }), `person ${label}`);
  await must(await rest("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: p.id, gender: WOMEN || i % 2 ? "woman" : "man", birth_year: 1994 }) }), "private");
  await must(await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: p.id, source: "a26" }) }), "19+");
  await rest("/rest/v1/person_tags", { method: "POST", body: JSON.stringify(TAGS.map((tag) => ({ person_id: p.id, tag }))) });
  await must(await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: u.id, p_on: true, p_actor: "ui-shots", p_note: "ui-shots" }) }), "tester");
  const session = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "sign in");
  people[label] = { authId: u.id, personId: p.id, photo, session };
}
// A call as one of the people, through their own session (every rule applies).
const as = async (label, fn, args) =>
  must(await fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${people[label].session.access_token}`, "content-type": "application/json" }, body: JSON.stringify(args) }), `${label} ${fn}`);
const says = async (label, roomId, body) => (await sleep(3200), true) &&
  must(await fetch(`${base}/rest/v1/room_messages`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${people[label].session.access_token}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify({ room_id: roomId, author_id: people[label].personId, body }) }), `${label} says`);

try {
  [gathering] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: "Leafs vs Bruins (UI shots)", starts_at: new Date(Date.now() + (process.env.TONIGHT ? 2 * 3_600_000 : 3 * 86_400_000)).toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "gathering");
  await must(await rest("/rest/v1/rpc/admin_mint_slug", { method: "POST", body: JSON.stringify({ p_gathering: gathering.id }) }), "slug");
  const [g] = await must(await rest(`/rest/v1/gatherings?id=eq.${gathering.id}&select=slug`), "the slug");
  for (const [i, n] of NAMES.entries()) await person(n, i);
  for (const n of NAMES) await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: gathering.id, person_id: people[n].personId, party_total: 1, open_to_meeting: true }) }), `opt in ${n}`);
  const roomId = (await must(await rest(`/rest/v1/room_members?person_id=eq.${people.Ari.personId}&gathering_id=eq.${gathering.id}&women_only=eq.false&select=room_id`), "room"))[0]?.room_id;
  if (!roomId) throw new Error("Ari was not placed in a room");
  if (NAMES.includes("Priya")) await says("Priya", roomId, "Anyone grabbing food before puck drop?");
  if (NAMES.includes("Dev")) await says("Dev", roomId, "I'm in. Getting there around 5:30.");
  await says("Ari", roomId, "Same, first time going solo. Count me in!");
  if (NAMES.includes("Priya")) await says("Priya", roomId, "Love it, see you there.");

  const port = 9700 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-uishots-"))}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let ws;
  for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0; const wait = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id)); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const body = () => evaluate("document.body.innerText").then(String);
  const until = async (text, ms = 20000) => { for (let t = 0; t < ms; t += 500) { if ((await body()).includes(text)) return true; await sleep(500); } return false; };
  // The app scrolls inside its own frame, so a shot of a lower part scrolls it into view.
  const scrollTo = (text) =>
    evaluate(`(() => { const e=[...document.querySelectorAll("div")].reverse().find(x=>x.childElementCount===0&&x.innerText&&x.innerText.trim()===${JSON.stringify(text)}); if(e) e.scrollIntoView({block:"start"}); return !!e; })()`);
  const snap = async (name, full = true) => {
    await sleep(1500);
    if (full) {
      const h = await evaluate("document.documentElement.scrollHeight");
      await send("Emulation.setDeviceMetricsOverride", { width: 393, height: Math.min(Math.max(h, 852), 4000), deviceScaleFactor: 2, mobile: true });
      await sleep(500);
    }
    writeFileSync(join(out, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
    console.log(`== ${name}\n${(await body()).slice(0, 700)}\n`);
    await send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  };
  await send("Page.enable");
  // The stand-in keyboard: a visual viewport that window.__kb(px) shortens, as iOS Safari's does.
  const KB = 336;
  if (process.env.KEYBOARD) {
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const ls = {}; let kb = 0;
      const vv = { get height() { return innerHeight - kb; }, get width() { return innerWidth; }, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
        addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); }, removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((x) => x !== f); } };
      Object.defineProperty(window, "visualViewport", { get: () => vv, configurable: true });
      window.__kb = (px) => { kb = px; (ls.resize || []).forEach((f) => f()); }; })();` });
  }
  let kbFailed = false;
  const kbStep = (what, pass, detail) => {
    console.log(`KB ${pass ? "ok  " : "FAIL"} ${what}${pass ? "" : " " + JSON.stringify(detail)}`);
    if (!pass) kbFailed = true;
  };
  // Where things are, in the window: the keyboard's top, the focused field, the box, a message.
  const geo = (text) =>
    evaluate(`(() => { const r = (e) => e ? (({ top, bottom }) => ({ top: Math.round(top), bottom: Math.round(bottom) }))(e.getBoundingClientRect()) : null;
      const want = ${JSON.stringify(text ?? "")};
      const msg = want ? [...document.querySelectorAll("div")].reverse().find((x) => x.childElementCount === 0 && x.innerText && x.innerText.trim() === want) : null;
      const a = document.activeElement;
      return { kbTop: Math.round(visualViewport.height), field: r(a && /INPUT|TEXTAREA/.test(a.tagName) ? a : null), box: r(document.querySelector("textarea")), msg: r(msg) }; })()`);
  const focusBox = () => evaluate(`(() => { const t = document.querySelector("textarea"); t && t.focus(); return !!t; })()`);
  // A conversation with the keyboard up: the newest message over the box, the box over the keyboard.
  const kbThread = async (where, newest) => {
    await focusBox();
    await evaluate(`window.__kb(${KB})`);
    await sleep(900);
    let g = await geo(newest);
    kbStep(`${where}: the box sits on the keyboard`, !!g.box && g.box.bottom <= g.kbTop && g.box.bottom >= g.kbTop - 120, g);
    kbStep(`${where}: the newest message is in view, over the box`, !!g.msg && !!g.box && g.msg.top >= 0 && g.msg.bottom <= g.box.top, g);
    await send("Input.insertText", { text: "Typing with the keyboard up, a line long enough to wrap onto a second line in the box" });
    await sleep(700);
    g = await geo(newest);
    kbStep(`${where}: typing, the box still sits on the keyboard`, !!g.box && g.box.bottom <= g.kbTop, g);
    kbStep(`${where}: typing, the newest message is still over the box`, !!g.msg && !!g.box && g.msg.top >= 0 && g.msg.bottom <= g.box.top, g);
    await snap(`kb-${where}`, false);
    await evaluate(`(() => { const t = document.querySelector("textarea"); if (t) { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(t, ""); t.dispatchEvent(new Event("input", { bubbles: true })); } window.__kb(0); return true; })()`);
    await sleep(400);
  };
  // A form field with the keyboard up: the field above the keyboard.
  const kbField = async (where, selector) => {
    await evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i && i.focus(); return !!i; })()`);
    await evaluate(`window.__kb(${KB})`);
    await sleep(900);
    const g = await geo();
    kbStep(`${where}: the field is above the keyboard`, !!g.field && g.field.top >= 0 && g.field.bottom <= g.kbTop, g);
  };
  await send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: `${SITE}/` });
  await sleep(1500);
  await evaluate(`localStorage.setItem(${JSON.stringify(`sb-${ref}-auth-token`)}, ${JSON.stringify(JSON.stringify(people.Ari.session))}); true`);

  // A squad of two, started by Priya, its name passed as the check would pass it.
  let squadId = null;
  if (NAMES.includes("Dev")) {
    const [spot] = await must(await rest(`/rest/v1/meeting_spots?venue_id=eq.${crowd.venue_id}&active=eq.true&select=id&limit=1`), "a spot");
    squadId = await as("Priya", "start_squad", { p_gathering: gathering.id, p_name: "Pre-game at the 300 level", p_spot: spot?.id ?? null, p_meet_at: squadTimes(gathering.starts_at, gathering.ends_at ?? null)[2], p_women_only: false });
    await rest(`/rest/v1/crews?id=eq.${squadId}`, { method: "PATCH", body: JSON.stringify({ name_status: "approved" }) });
    await as("Dev", "join_squad", { p_crew: squadId });
  }
  await send("Page.navigate", { url: `${SITE}/crowd/${g.slug}` });
  await until("Open to meeting");
  await snap("a9-open");
  if (process.env.TONIGHT) {
    // The night's switch (088): Priya says she's here through her own session, then Ari
    // turns it on in the browser, which asks for the line first.
    await as("Priya", "set_here", { p_gathering: gathering.id, p_note: "yellow raincoat" });
    await send("Page.reload");
    await until("I've arrived");
    await evaluate(`(() => { const s=[...document.querySelectorAll('[role=switch]')].find(e=>e.innerText.includes("I've arrived")); s && s.click(); return !!s; })()`);
    await until("What are you wearing");
    await snap("a9-here-ask", false);
    await evaluate(`(() => { const i=[...document.querySelectorAll('input')].find(x=>x.placeholder==="green Matthews jersey"); i && i.focus(); return !!i; })()`);
    await send("Input.insertText", { text: "green Matthews jersey" });
    await sleep(300);
    await evaluate(`(() => { const b=[...document.querySelectorAll('[role=button]')].filter(e=>e.innerText.trim()==="Tell them").pop(); b && b.click(); return !!b; })()`);
    await until("You've arrived");
    await snap("a9-here", false);
  }
  // The person sheet (item 8): Ari's own 1-on-1 switch is off, so the sheet says so, with it.
  await scrollTo("Open to meeting");
  await evaluate(`(() => { const b=[...document.querySelectorAll('[role=button]')].find(e=>e.innerText.startsWith(${JSON.stringify(NAMES[1])})); b && b.click(); return !!b; })()`);
  await until("See their profile");
  await snap("a9-sheet", false);
  await evaluate(`(() => { const b=[...document.querySelectorAll('[aria-label=Close]')][0]; b && b.click(); return !!b; })()`);
  await sleep(500);
  await scrollTo("Squads");
  await snap("a9-squads", false);
  // The squad form (064/065): empty, then named with a curated place and a time in words.
  await evaluate(`(() => { const b=[...document.querySelectorAll('[role=button]')].find(e=>e.innerText.trim()==="+ Start a squad"); b && b.click(); return !!b; })()`);
  await until("Meeting point");
  await snap("a15-form", false);
  await evaluate(`(() => { const i=[...document.querySelectorAll('input')].find(x=>x.placeholder==="e.g. 300 level pre-game"); i && i.focus(); return !!i; })()`);
  if (process.env.KEYBOARD) await kbField("the squad form's name", 'input[placeholder="e.g. 300 level pre-game"]');
  await send("Input.insertText", { text: "Section 314 pre-game" });
  await evaluate(`(() => { const i=[...document.querySelectorAll('textarea')].find(x=>x.placeholder&&x.placeholder.startsWith("Anything people")); i && i.focus(); return !!i; })()`);
  await send("Input.insertText", { text: "First time solo, happy to grab a drink before." });
  await evaluate(`(() => { const b=[...document.querySelectorAll('[role=button]')].find(e=>e.innerText.trim()==="Add a place"); b && b.click(); return !!b; })()`);
  await sleep(400);
  await snap("a15-form-places", false);
  await evaluate(`(() => { const b=[...document.querySelectorAll('[role=radio]')].find(e=>e.innerText.trim()==="At the event itself"); b && b.click(); return !!b; })()`);
  await evaluate(`(() => { const b=[...document.querySelectorAll('[role=button]')].find(e=>e.innerText.trim()==="Add a time"); b && b.click(); return !!b; })()`);
  await sleep(300);
  await evaluate(`(() => { const i=[...document.querySelectorAll('input')].find(x=>x.placeholder==="e.g. around 5:30 p.m."); i && i.focus(); return !!i; })()`);
  if (process.env.KEYBOARD) await kbField("the squad form's time, at its foot", 'input[placeholder="e.g. around 5:30 p.m."]');
  await send("Input.insertText", { text: "around 5:30" });
  await sleep(300);
  await snap(process.env.KEYBOARD ? "kb-a15-form" : "a15-form-filled", false);
  if (process.env.KEYBOARD) {
    await evaluate("window.__kb(0)");
    await sleep(400);
  }
  await evaluate(`(() => { const b=[...document.querySelectorAll('[role=button]')].find(e=>e.innerText.trim()==="Close"||e.getAttribute("aria-label")==="Close"); b && b.click(); return !!b; })()`);
  await sleep(500);
  if (squadId) {
    await as("Ari", "join_squad", { p_crew: squadId });
    await sleep(3200);
    await must(await fetch(`${base}/rest/v1/crew_messages`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${people.Dev.session.access_token}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify({ crew_id: squadId, author_id: people.Dev.personId, kind: "user", body: "Hey! Where are you two sitting?" }) }), "Dev in the squad");
    await send("Page.navigate", { url: `${SITE}/crowd/${g.slug}` });
    await until("Open to meeting");
    await scrollTo("Your squad");
    await snap("a9-my-squad", false);
    await send("Page.navigate", { url: `${SITE}/group/${squadId}` });
    await until("Where are you two sitting");
    await snap("a11-squad", false);
    // The ••• sheet (item 9): what used to sit above the chat.
    await evaluate(`(() => { const b=document.querySelector('[aria-label=More]'); b && b.click(); return !!b; })()`);
    await until("Leave this squad");
    await snap("a11-more", false);
    await evaluate(`(() => { const b=[...document.querySelectorAll('[role=button]')].filter(e=>e.innerText.trim()==="Close").pop(); b && b.click(); return !!b; })()`);
    await sleep(500);
    if (process.env.KEYBOARD) await kbThread("a11-squad", "Hey! Where are you two sitting?");
  }
  await send("Page.navigate", { url: `${SITE}/room/${roomId}` });
  await until("Love it, see you there.") || await until(NAMES[1]);
  await snap("a10-room", false);
  if (process.env.KEYBOARD) await kbThread("a10-room", NAMES.includes("Priya") ? "Love it, see you there." : "Same, first time going solo. Count me in!");
  await send("Page.navigate", { url: `${SITE}/my-events` });
  await until("My Events");
  await snap("a19");
  if (WOMEN) {
    const wo = (await must(await rest(`/rest/v1/room_members?person_id=eq.${people.Ari.personId}&gathering_id=eq.${gathering.id}&women_only=eq.true&select=room_id`), "women-only room"))[0]?.room_id;
    await send("Page.navigate", { url: `${SITE}/crowd/${g.slug}` });
    await until("Open to meeting");
    await scrollTo("Women-only room");
    await snap("a9-women", false);
    if (wo) {
      await send("Page.navigate", { url: `${SITE}/room/${wo}` });
      await until("Women only");
      await snap("a10-women", false);
    }
    await send("Page.navigate", { url: `${SITE}/settings` });
    await until("How you meet");
    await scrollTo("How you meet");
    await snap("a23", false);
  }
  if (kbFailed) process.exitCode = 1;
  ws.close();
} catch (err) {
  console.log(String(err.stack ?? err));
  process.exitCode = 1;
} finally {
  chrome?.kill();
  for (const p of Object.values(people)) {
    await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: p.authId, p_on: false, p_actor: "ui-shots" }) }).catch(() => undefined);
    await rest(`/rest/v1/people?auth_user_id=eq.${p.authId}`, { method: "DELETE" });
    await fetch(`${base}/storage/v1/object/photos/${p.photo}`, { method: "DELETE", headers: S }).catch(() => undefined);
    await rest(`/auth/v1/admin/users/${p.authId}`, { method: "DELETE" });
  }
  if (gathering) await rest(`/rest/v1/gatherings?id=eq.${gathering.id}`, { method: "DELETE" });
}
