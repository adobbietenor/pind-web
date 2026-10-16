// What a message costs the phone, measured in real headless Chrome (A10, A11/A29 — the
// thread pass, 16 Oct 2026). Not a pass/fail check: it prints numbers to compare.
//
//   1  open the room                      → Supabase requests to the first message on screen
//   2  someone else posts, five times      → requests each one costs the reader, how long
//                                            until it is on screen, and avatar re-downloads
//   3  I post, five times                  → tap Send to the words on screen, and to confirmed
//   4  thirty quiet seconds                → what the poll costs while nothing happens
//
// Run twice per build: unthrottled, then Lighthouse's mobile profile (150 ms RTT, 1.6 Mb/s
// down, 675 kb/s up, CPU ×4) — "measure what the phone does, not what the server sent".
//
//   npm run build:web && npm run measure:thread
//
// It serves the LOCAL web export (app/dist) on 127.0.0.1 against pind-staging, so it
// measures the code on disk without a deploy. The session is put in localStorage
// directly, which skips the Worker's hand-off: fine for measuring a thread, and the
// reason this is not a check of anything to do with signing in (check:tester-session is).
// Four harness people, made testers for the run, never emailed; all deleted at the end,
// person first, then account.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fixture, needChrome, needEnv, testCrowd } from "./fixture.mjs";

needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
needChrome(CHROME);
const DIST = join(process.cwd(), "app", "dist");
if (!existsSync(join(DIST, "index.html"))) fixture("app/dist has no web export — run `npm run build:web` first.");
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
if (!base.includes("mxuajvlrkggrqpntekqt")) fixture("SUPABASE_URL is not pind-staging — this script only ever touches staging.");
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
const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const LABEL = process.argv[2] ?? "this build";

// A 1×1 PNG, so every photo really signs and really downloads.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// The local web export, with the app's single-page fallback (as the Worker's assets do).
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/session/claim") return res.writeHead(204).end();
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const SITE = `http://127.0.0.1:${server.address().port}`;

const crowd = await testCrowd({ pinnable: false });
const people = {};
let gathering = null;
let chrome;

async function person(label) {
  const email = `pind-threadcost-${label.toLowerCase()}-${Date.now()}@example.com`;
  const password = randomUUID();
  const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), `user ${label}`);
  const photo = `${u.id}/face-${Date.now()}.png`;
  await must(await fetch(`${base}/storage/v1/object/photos/${photo}`, { method: "POST", headers: { ...S, "content-type": "image/png" }, body: PNG }), `photo ${label}`);
  const [p] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: u.id, first_name: label, photo_path: photo }) }), `person ${label}`);
  await must(await rest("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: p.id, gender: "man", birth_year: 1994 }) }), "private");
  await must(await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: p.id, source: "a26" }) }), "19+");
  await must(await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: u.id, p_on: true, p_actor: "thread-cost", p_note: "thread-cost" }) }), "tester");
  const session = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "sign in");
  people[label] = { authId: u.id, personId: p.id, photo, session };
}
const optIn = async (label) => must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: gathering.id, person_id: people[label].personId, party_total: 1, open_to_meeting: true }) }), `opt in ${label}`);
// Bea posts as herself, through her own session: every rule applies, and Chrome never sees it.
const says = async (label, roomId, body) =>
  must(await fetch(`${base}/rest/v1/room_messages`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${people[label].session.access_token}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify({ room_id: roomId, author_id: people[label].personId, body }) }), `${label} says`);

const report = { label: LABEL, profiles: {} };
try {
  [gathering] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: `Thread cost ${Date.now()}`, starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "gathering");
  for (const n of ["Ari", "Bea", "Cal", "Dee"]) await person(n);
  for (const n of ["Ari", "Bea", "Cal", "Dee"]) await optIn(n);
  const roomId = (await must(await rest(`/rest/v1/room_members?person_id=eq.${people.Ari.personId}&gathering_id=eq.${gathering.id}&women_only=eq.false&select=room_id`), "room"))[0]?.room_id;
  if (!roomId) throw new Error("Ari was not placed in a room");
  const together = await must(await rest(`/rest/v1/room_members?room_id=eq.${roomId}&left_at=is.null&select=person_id`), "members");
  if (together.length !== 4) throw new Error(`expected 4 in Ari's room, found ${together.length}`);
  // A room with history: 240 earlier messages (the service key skips the per-person rate limit).
  const authors = ["Bea", "Cal", "Dee"];
  const t0 = Date.now() - 2 * 3_600_000;
  const history = Array.from({ length: 240 }, (_, i) => ({ room_id: roomId, author_id: people[authors[i % 3]].personId, body: `earlier message ${i + 1} — ${"words ".repeat(6 + (i % 9))}`.trim(), created_at: new Date(t0 + i * 20_000).toISOString() }));
  await must(await rest("/rest/v1/room_messages", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(history) }), "history");

  const port = 9700 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-thread-"))}`, "about:blank"], { stdio: "ignore" });
  let ws;
  for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0; const wait = new Map();
  const requests = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id));
    if (m.method === "Network.requestWillBeSent") {
      const { request, type, wallTime } = m.params;
      const u = new URL(request.url);
      if (u.hostname.endsWith(".supabase.co") && request.method !== "OPTIONS" && type !== "WebSocket") {
        requests.push({ at: wallTime * 1000, what: `${request.method} ${u.pathname.replace(/^\/(rest|storage|auth)\/v1/, "$1").replace(/[0-9a-f-]{36}.*$/, "…")}`, image: type === "Image" });
      }
    }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`page: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
    return r.result?.result?.value;
  };
  const between = (from, to) => requests.filter((r) => r.at >= from && r.at < to);
  const tally = (rs) => Object.entries(rs.reduce((acc, r) => ((acc[r.what] = (acc[r.what] ?? 0) + 1), acc), {})).map(([k, v]) => `${v}× ${k}`).join(", ");

  // Watching for words on the page, timed in the page's own clock.
  const HELPERS = `
    window.__leaf = (t) => [...document.querySelectorAll('div,span')].find((d) => d.childElementCount === 0 && d.textContent === t);
    window.__appear = (t, ms) => new Promise((res) => {
      const done = () => { if (window.__leaf(t)) { obs.disconnect(); clearTimeout(timer); res(Date.now()); return true; } return false; };
      const obs = new MutationObserver(done);
      const timer = setTimeout(() => { obs.disconnect(); res(null); }, ms);
      if (!done()) obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    window.__sendTimed = (t) => new Promise((res) => {
      const box = document.querySelector('textarea');
      const btn = [...document.querySelectorAll('[role=button]')].filter((e) => e.innerText.trim() === 'Send').pop();
      if (!btn) return res({ error: 'no Send button' });
      let appear = null;
      const check = () => {
        const leaf = window.__leaf(t);
        if (leaf && appear === null) appear = performance.now() - t0;
        if (leaf && !/Sending/.test(leaf.parentElement.textContent)) { obs.disconnect(); res({ appear, confirmed: performance.now() - t0 }); }
      };
      const obs = new MutationObserver(check);
      obs.observe(document.body, { subtree: true, childList: true, characterData: true });
      setTimeout(() => { obs.disconnect(); res({ appear, confirmed: null }); }, 30000);
      const t0 = performance.now();
      btn.click();
    });`;

  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.navigate", { url: SITE });
  await sleep(1500);
  await evaluate(`localStorage.setItem(${JSON.stringify(`sb-${ref}-auth-token`)}, ${JSON.stringify(JSON.stringify(people.Ari.session))}); true`);

  const ALL_PROFILES = [
    { name: "unthrottled", net: null, cpu: 1 },
    { name: "mobile (150 ms RTT, 1.6 Mb/s, CPU ×4)", net: { offline: false, latency: 150, downloadThroughput: (1638.4 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 }, cpu: 4 },
  ];
  const PROFILES = process.env.THREAD_PROFILES === "1" ? ALL_PROFILES.slice(0, 1) : ALL_PROFILES;
  let k = 0;
  for (const prof of PROFILES) {
    const out = {};
    await send("Network.emulateNetworkConditions", prof.net ?? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await send("Emulation.setCPUThrottlingRate", { rate: prof.cpu });
    await send("Network.setCacheDisabled", { cacheDisabled: false });

    // 1 — open the room.
    const openAt = Date.now();
    await send("Page.navigate", { url: `${SITE}/room/${roomId}` });
    await sleep(300);
    await evaluate(HELPERS);
    const shown = await evaluate(`window.__appear(${JSON.stringify(history.at(-1).body)}, 30000)`);
    if (!shown) throw new Error(`the room did not show its newest message (${prof.name}):\n${(await evaluate("document.body.innerText")).slice(0, 600)}`);
    await sleep(4000);
    out.open = { ms: shown - openAt, requests: between(openAt, Date.now()).filter((r) => !r.image).length, images: between(openAt, Date.now()).filter((r) => r.image).length, detail: tally(between(openAt, Date.now())) };
    await sleep(2000);

    // 2 — someone else posts.
    out.incoming = [];
    for (let i = 0; i < 5; i++) {
      const token = `incoming ${++k} ${randomUUID().slice(0, 8)}`;
      const seen = evaluate(`window.__appear(${JSON.stringify(token)}, 30000)`);
      const from = Date.now();
      await says(authors[i % 3], roomId, token);
      const committed = Date.now();
      const at = await seen;
      await sleep(5000);
      const rs = between(from, Date.now());
      out.incoming.push({ ms: at ? at - committed : null, requests: rs.filter((r) => !r.image).length, images: rs.filter((r) => r.image).length, detail: tally(rs) });
      await sleep(1500);
    }

    // 3 — I post.
    out.send = [];
    for (let i = 0; i < 5; i++) {
      const token = `mine ${++k} ${randomUUID().slice(0, 8)}`;
      await evaluate(`(() => { const b = document.querySelector('textarea'); b.focus(); return !!b; })()`);
      await send("Input.insertText", { text: token });
      await sleep(400);
      const from = Date.now();
      const r = await evaluate(`window.__sendTimed(${JSON.stringify(token)})`);
      if (r?.error) throw new Error(r.error);
      await sleep(5000);
      const rs = between(from, Date.now());
      out.send.push({ appearMs: r.appear === null ? null : Math.round(r.appear), confirmedMs: r.confirmed === null ? null : Math.round(r.confirmed), requests: rs.filter((x) => !x.image).length, images: rs.filter((x) => x.image).length, detail: tally(rs) });
      await sleep(1500);
    }

    // The web composer, once, unthrottled: Enter sends, Shift+Enter is a new line, the box
    // stops growing at about five lines, and the newest message sits above the box.
    if (prof.cpu === 1 && process.env.THREAD_COMPOSER !== "0") {
      const key = (type, extra = {}) => send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...extra });
      const enter = async (modifiers = 0) => { await key("rawKeyDown", { modifiers }); await key("char", { text: "\r", modifiers }); await key("keyUp", { modifiers }); };
      const c = {};
      const token = `enter ${++k} ${randomUUID().slice(0, 8)}`;
      await evaluate(`document.querySelector('textarea').focus(), true`);
      await send("Input.insertText", { text: token });
      const appeared = evaluate(`window.__appear(${JSON.stringify(token)}, 10000)`);
      await enter();
      c.enterSends = !!(await appeared) && (await evaluate(`document.querySelector('textarea').value`)) === "";
      await sleep(3500);
      await send("Input.insertText", { text: "line one" });
      await enter(8); // Shift
      await send("Input.insertText", { text: "line two" });
      await sleep(300);
      const v = await evaluate(`document.querySelector('textarea').value`);
      c.shiftEnterIsNewLine = v === "line one\nline two";
      if (process.env.THREAD_DEBUG) await evaluate(`(() => { const b = document.querySelector('textarea'); window.__log = []; window.addEventListener('keydown', (e) => window.__log.push(['WINDOW keydown', e.key, e.defaultPrevented, document.activeElement === b, (() => { const a = document.activeElement; return a ? [a.tagName, a.getAttribute('role'), a.getAttribute('tabindex'), (a.innerText || '').slice(0, 30)].join('|') : 'none'; })()].join(' ')), true); document.addEventListener('focusin', (e) => window.__log.push(['FOCUSIN', e.target.tagName, e.target.getAttribute('role'), (e.target.innerText || '').slice(0, 20)].join(' ')), true); for (const t of ['keydown','keypress','beforeinput','input','keyup']) b.addEventListener(t, (e) => window.__log.push([t, e.key ?? e.inputType ?? '', e.defaultPrevented, JSON.stringify(b.value.slice(-8))].join(' ')), true); return true; })()`);
      // Typed at a person's pace, not in one CDP burst.
      for (let i = 3; i <= 9; i++) { await enter(8); await sleep(80); await send("Input.insertText", { text: `line ${i}` }); await sleep(80); }
      await sleep(400);
      c.typed = await evaluate(`document.querySelector("textarea").value`);
      if (process.env.THREAD_DEBUG) console.log((await evaluate(`window.__log.join(String.fromCharCode(10))`)));
      c.nineLinesKept = c.typed === Array.from({ length: 9 }, (_, i) => (i === 0 ? "line one" : i === 1 ? "line two" : `line ${i + 1}`)).join(String.fromCharCode(10));
      const geo = await evaluate(`(() => {
        const box = document.querySelector('textarea').getBoundingClientRect();
        const last = [...document.querySelectorAll('div')].filter((d) => d.childElementCount === 0 && d.textContent === ${JSON.stringify(token)}).pop()?.getBoundingClientRect();
        return { boxHeight: Math.round(box.height), boxBottom: Math.round(box.bottom), boxTop: Math.round(box.top), viewport: innerHeight, lastBottom: last ? Math.round(last.bottom) : null };
      })()`);
      c.nineLines = geo;
      // Someone posts while I type: the frame follows the newest message, and my box keeps its focus and its words.
      const midTyping = `while typing ${++k} ${randomUUID().slice(0, 8)}`;
      const landed = evaluate(`window.__appear(${JSON.stringify(midTyping)}, 10000)`);
      await says("Bea", roomId, midTyping);
      await landed;
      await sleep(400);
      c.keepsFocusWhenMessageArrives = await evaluate(`document.activeElement === document.querySelector('textarea') && document.querySelector('textarea').value === ${JSON.stringify(c.typed ?? "")}`);
      // The faces, scrolled into view: each must actually load (and only from a signed URL).
      await evaluate(`(() => { const s = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === 'auto' || getComputedStyle(d).overflowY === 'scroll'); if (s) s.scrollTop = 0; return true; })()`);
      await sleep(2500);
      c.faces = await evaluate(`[...document.querySelectorAll('img')].filter((i) => i.src.includes('/storage/v1/object/sign/photos/')).map((i) => i.naturalWidth > 0)`);
      c.facesLoad = c.faces.length === 3 && c.faces.every(Boolean);
      await evaluate(`document.querySelector('textarea').blur(), document.querySelector('textarea').focus(), true`);
      await sleep(2500);
      // Focusing the box from history brings the newest message back over it.
      const back = await evaluate(`(() => { const box = document.querySelector('textarea').getBoundingClientRect(); const last = [...document.querySelectorAll('div')].filter((d) => d.childElementCount === 0 && d.textContent === ${JSON.stringify(token)}).pop()?.getBoundingClientRect(); return last ? last.bottom > 0 && last.bottom <= box.top : false; })()`);
      c.focusReturnsToNewest = back;
      if (process.env.THREAD_DEBUG) {
        console.log(await evaluate(`JSON.stringify({ scrollY, docH: document.scrollingElement.scrollHeight, vv: visualViewport.height, chain: (() => { const out = []; let e = document.querySelector('textarea'); while (e && out.length < 14) { const s = getComputedStyle(e); out.push([e.tagName, Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().height), s.flex, s.height, s.overflowY, s.minHeight].join(' ')); e = e.parentElement; } return out; })(), imgs: [...document.querySelectorAll('img')].map((i) => [i.src.slice(0, 60), i.naturalWidth, Math.round(i.getBoundingClientRect().width)]) }, null, 1)`));
      }
      c.boxCapped = geo.boxHeight <= 132;
      c.boxOnScreen = geo.boxBottom <= geo.viewport;
      c.newestAboveBox = geo.lastBottom !== null && geo.lastBottom > 0 && geo.lastBottom <= geo.boxTop;
      c.boxAtFoot = geo.boxBottom > geo.viewport - 60;
      if (process.env.THREAD_SHOT) {
        const shot = await send("Page.captureScreenshot", { format: "png" });
        (await import("node:fs")).writeFileSync(process.env.THREAD_SHOT, Buffer.from(shot.result.data, "base64"));
      }
      await evaluate(`(() => { const b = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(b, ''); b.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      out.composer = c;
      await sleep(3500);
    }

    // 4 — quiet.
    const quietFrom = Date.now();
    await sleep(30_000);
    const quiet = between(quietFrom, Date.now());
    out.quiet30s = { requests: quiet.filter((r) => !r.image).length, images: quiet.filter((r) => r.image).length, detail: tally(quiet) };

    out.summary = {
      openMs: out.open.ms,
      openRequests: out.open.requests,
      incomingRequestsMedian: median(out.incoming.map((x) => x.requests)),
      incomingImagesMedian: median(out.incoming.map((x) => x.images)),
      incomingMsMedian: median(out.incoming.map((x) => x.ms)),
      sendAppearMsMedian: median(out.send.map((x) => x.appearMs)),
      sendConfirmedMsMedian: median(out.send.map((x) => x.confirmedMs)),
      sendRequestsMedian: median(out.send.map((x) => x.requests)),
      quiet30sRequests: out.quiet30s.requests,
    };
    report.profiles[prof.name] = out;
    console.log(`\n== ${LABEL} · ${prof.name}`);
    console.log(JSON.stringify(out.summary, null, 2));
    console.log(`  open: ${out.open.detail}`);
    out.incoming.forEach((x, i) => console.log(`  incoming ${i + 1}: ${x.ms} ms · ${x.requests} req + ${x.images} img — ${x.detail || "none"}`));
    out.send.forEach((x, i) => console.log(`  send ${i + 1}: on screen ${x.appearMs} ms, confirmed ${x.confirmedMs} ms · ${x.requests} req — ${x.detail || "none"}`));
    console.log(`  quiet 30 s: ${out.quiet30s.detail || "none"}`);
    if (out.composer) console.log(`  composer: ${JSON.stringify(out.composer)}`);
  }
  // The group screen — a squad, and the same screen as a 1-on-1 plan (A11, A29). Unthrottled,
  // three of each: does the same thread behave the same way there?
  if (process.env.THREAD_GROUP !== "0") {
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const [spot] = await must(await rest(`/rest/v1/meeting_spots?active=eq.true&select=id&limit=1`), "a spot");
    const [crew] = await must(await rest("/rest/v1/crews", { method: "POST", body: JSON.stringify({ gathering_id: gathering.id, state: "spot_set", spot_id: spot.id, meet_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), kind: "crew", name: "Thread cost squad", name_status: "approved" }) }), "squad");
    for (const n of ["Ari", "Bea", "Cal"]) await must(await rest("/rest/v1/crew_members", { method: "POST", body: JSON.stringify({ crew_id: crew.id, gathering_id: gathering.id, person_id: people[n].personId, kind: "crew" }) }), `${n} in the squad`);
    const g = { incoming: [], send: [] };
    const openAt = Date.now();
    await send("Page.navigate", { url: `${SITE}/group/${crew.id}` });
    await sleep(300);
    await evaluate(HELPERS);
    const opened = await evaluate(`window.__appear("Leave this squad", 20000)`);
    if (!opened) throw new Error(`the squad did not open:\n${(await evaluate("document.body.innerText")).slice(0, 400)}`);
    await sleep(4000);
    g.open = { requests: between(openAt, Date.now()).filter((r) => !r.image).length };
    for (let i = 0; i < 3; i++) {
      const token = `squad incoming ${++k} ${randomUUID().slice(0, 8)}`;
      const seen = evaluate(`window.__appear(${JSON.stringify(token)}, 30000)`);
      const from = Date.now();
      await must(await fetch(`${base}/rest/v1/crew_messages`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${people.Bea.session.access_token}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify({ crew_id: crew.id, author_id: people.Bea.personId, kind: "user", body: token }) }), "Bea in the squad");
      const committed = Date.now();
      const at = await seen;
      await sleep(5000);
      const rs = between(from, Date.now());
      g.incoming.push({ ms: at ? at - committed : null, requests: rs.filter((r) => !r.image).length, images: rs.filter((r) => r.image).length, detail: tally(rs) });
    }
    for (let i = 0; i < 3; i++) {
      const token = `squad mine ${++k} ${randomUUID().slice(0, 8)}`;
      await evaluate(`document.querySelector('textarea').focus(), true`);
      await send("Input.insertText", { text: token });
      await sleep(400);
      const from = Date.now();
      const r = await evaluate(`window.__sendTimed(${JSON.stringify(token)})`);
      if (r?.error) throw new Error(r.error);
      await sleep(5000);
      const rs = between(from, Date.now());
      g.send.push({ appearMs: r.appear === null ? null : Math.round(r.appear), confirmedMs: r.confirmed === null ? null : Math.round(r.confirmed), requests: rs.filter((x) => !x.image).length, detail: tally(rs) });
    }
    // Enter, in the squad's box too (the old screen had no Enter: expect false there).
    const token = `squad enter ${++k} ${randomUUID().slice(0, 8)}`;
    await evaluate(`document.querySelector('textarea').focus(), true`);
    await send("Input.insertText", { text: token });
    const appeared = evaluate(`window.__appear(${JSON.stringify(token)}, 8000)`);
    for (const type of ["rawKeyDown", "char", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === "char" ? { text: "\r" } : {}) });
    g.enterSends = !!(await appeared);
    g.summary = { openRequests: g.open.requests, incomingRequestsMedian: median(g.incoming.map((x) => x.requests)), incomingImagesMedian: median(g.incoming.map((x) => x.images)), incomingMsMedian: median(g.incoming.map((x) => x.ms)), sendAppearMsMedian: median(g.send.map((x) => x.appearMs)), sendConfirmedMsMedian: median(g.send.map((x) => x.confirmedMs)), sendRequestsMedian: median(g.send.map((x) => x.requests)), enterSends: g.enterSends };
    report.group = g;
    console.log(`\n== ${LABEL} · the squad screen (unthrottled)`);
    console.log(JSON.stringify(g.summary, null, 2));
    g.incoming.forEach((x, i) => console.log(`  incoming ${i + 1}: ${x.ms} ms · ${x.requests} req + ${x.images} img — ${x.detail || "none"}`));
    g.send.forEach((x, i) => console.log(`  send ${i + 1}: on screen ${x.appearMs} ms, confirmed ${x.confirmedMs} ms · ${x.requests} req — ${x.detail || "none"}`));
    await rest(`/rest/v1/crews?id=eq.${crew.id}`, { method: "DELETE" });
  }
  ws.close();
} catch (err) {
  console.log(String(err.stack ?? err));
  process.exitCode = 1;
} finally {
  chrome?.kill();
  server.close();
  for (const p of Object.values(people)) {
    await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: p.authId, p_on: false, p_actor: "thread-cost" }) }).catch(() => undefined);
    await rest(`/rest/v1/people?auth_user_id=eq.${p.authId}`, { method: "DELETE" });
    await fetch(`${base}/storage/v1/object/photos/${p.photo}`, { method: "DELETE", headers: S }).catch(() => undefined);
    await rest(`/auth/v1/admin/users/${p.authId}`, { method: "DELETE" });
  }
  if (gathering) await rest(`/rest/v1/gatherings?id=eq.${gathering.id}`, { method: "DELETE" });
}
