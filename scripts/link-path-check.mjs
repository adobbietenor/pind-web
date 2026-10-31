// The whole link path, walked in real headless Chrome (M3.2) — before Alex walks it.
//
// Alex: "Tell me when the whole path is walkable end to end … I'm not walking it in pieces
// again." So this walks it, as a tester on the test crowd, from the quick pin to faces:
//
//   app A26 (tick "meet up") → "Next: a few details" → A27 "you" (date of birth, gender,
//   a photo through the real file picker) → "where" (a neighbourhood, three tags) →
//   "identity" (Apple and Google offered; the email code, naming its address) → the
//   safety sheet → A9, open to meeting.
//
// Three walks — two ways through "identity", and one that skips "where":
//   fresh   a new address. The code goes to Resend's simulated inbox, which a script
//           cannot read, so after checking the screen names the address the admin API
//           confirms it — the one step Alex's walk does for real.
//   merge   an address that already has an account (with nothing on it). A real sign-in
//           code is minted with the admin API and TYPED into the page; the merge runs
//           through the live Worker, and the account must end with everything given on
//           the way: the photo in its own folder, date of birth and gender, the
//           neighbourhood, the three tags, the pin — open.
//
//   skip    Skip at "where": Profile must then name the neighbourhood and tags as
//           missing, with a way to each, and the neighbourhood must save from there.
//
//   a1      #11, Tatiana's shape: an account already pinned to the crowd (her phone), a
//           browser that quick-pins it again anonymously, then Crowds → "Set up my
//           profile" → A1 with the account's address. A1 used to sign in over the
//           anonymous session and leave that person counted: the crowd must end with
//           the count it started with, and one pin, the account's.
//
//   npm run check:link-path              all of them
//   npm run check:link-path -- merge     one
//
// Every user it makes is a harness user (the photo check skips them) and is deleted at
// the end, with their files. Addresses are delivered+…@resend.dev: nothing bounces.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { seal } from "../src/public/sealed.ts";
import { ALL_TAGS } from "../packages/shared/src/tags.ts";
import { NEIGHBOURHOODS } from "../packages/shared/src/neighbourhoods.ts";
import { CODE_SENT_TO, PROFILE_GAP_ACTION, profileGapLine, profileGaps } from "../packages/shared/src/profile.ts";
import { OPTIN_COPY } from "../packages/shared/src/optin.ts";
import { ONE_ON_ONE_COPY } from "../packages/shared/src/solo.ts";
import { QUICKPIN_COPY } from "../packages/shared/src/quickpin.ts";
import { HOME_COPY, PROFILE_OFFER } from "../packages/shared/src/cities.ts";
import { needChrome, needEnv, sessionSecretMatches, testCrowd } from "./fixture.mjs";

// Fixtures first: a check whose ground moved says so in a sentence (scripts/fixture.mjs).
needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SESSION_SECRET");

const SITE = process.env.PIND_SITE || "https://pind.social";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
needChrome(CHROME);
await sessionSecretMatches(SITE);
const PHOTO = resolve("tests/photos/cartoon.jpg");
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
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
const HOOD = NEIGHBOURHOODS[1];
const TAGS = ALL_TAGS.slice(0, 3);

const crowd = await testCrowd({ pinnable: true });

async function walk(kind) {
  const made = [];
  let secondGathering = null;
  // The merge's own record (M3.3, spec §7), read after the live /account/merge.
  const mergeRecord = async (authId) => {
    const [acct] = await must(await rest(`/rest/v1/people?auth_user_id=eq.${authId}&select=id`), "account person");
    return must(await rest(`/rest/v1/account_merges?person_id=eq.${acct.id}&select=method,platform,via`), "merge record");
  };
  const log = (s) => console.log(`[${kind}] ${s}`);
  let chrome;
  const result = {};
  try {
    // The tester button's own steps: an anonymous user, a tester, the sealed cookie.
    const signup = await must(await fetch(`${base}/auth/v1/signup`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ data: {} }) }), "anon sign-up");
    const anonId = signup.user.id;
    made.push(anonId);
    await must(await rest(`/auth/v1/admin/users/${anonId}`, { method: "PUT", body: JSON.stringify({ app_metadata: { pind_harness: true } }) }), "mark anon");
    await must(await rest("/rest/v1/rpc/admin_add_anonymous_tester", { method: "POST", body: JSON.stringify({ p_user: anonId, p_actor: "link-path-check" }) }), "tester");
    const cookie = await seal(process.env.SESSION_SECRET, { userId: anonId, refreshToken: signup.refresh_token, issuedAt: Date.now() });

    const email = `delivered+pind-${kind}-${Date.now()}@resend.dev`;
    let accountId = null;
    if (kind === "returning") {
      // Alex in November: a complete account (photo, date of birth and gender, where),
      // and a browser that has forgotten him.
      const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: randomUUID(), email_confirm: true, app_metadata: { pind_harness: true } }) }), "account");
      accountId = u.id;
      made.push(accountId);
      const [acct] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: accountId, first_name: "Returner", photo_path: `${accountId}/face.png`, neighbourhood: HOOD.slug }) }), "account person");
      await must(await rest("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: acct.id, gender: "man", birth_year: 1990 }) }), "account private");
      await must(await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: acct.id, source: "a26" }) }), "19+");
      await must(await rest("/rest/v1/person_tags", { method: "POST", body: JSON.stringify(TAGS.map((t) => ({ person_id: acct.id, tag: t.slug }))) }), "tags");
    }
    let pinnedBefore = null;
    if (kind === "a1") {
      // Tatiana's account, already pinned to the crowd from her phone.
      const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: randomUUID(), email_confirm: true, app_metadata: { pind_harness: true } }) }), "account");
      accountId = u.id;
      made.push(accountId);
      const [acct] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: accountId, first_name: "Phonepinner" }) }), "account person");
      await must(await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: acct.id, source: "a26" }) }), "19+");
      await must(await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: crowd.id, person_id: acct.id }) }), "the phone's pin");
      pinnedBefore = (await must(await rest(`/rest/v1/pins?gathering_id=eq.${crowd.id}&select=id`), "pins before")).length;
    }
    if (kind === "merge") {
      // An existing account with nothing on it, and NOT a tester — exactly Alex's. The
      // first version of this check made it a tester "as Alex's would be", and so walked
      // the failing path (the tester flag lost at the merge) and reported success.
      const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: randomUUID(), email_confirm: true, app_metadata: { pind_harness: true } }) }), "account");
      accountId = u.id;
      made.push(accountId);
      await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: accountId, first_name: "Mergeaccount" }) }), "account person");
      const listed = await must(await rest("/rest/v1/rpc/admin_testers", { method: "POST", body: "{}" }), "testers");
      if (listed.some((t) => t.auth_user_id === accountId)) throw new Error("the account is a tester before the walk — the check would prove nothing");
    }

    const port = 9700 + Math.floor(Math.random() * 90);
    chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pind-link-"))}`, "about:blank"], { stdio: "ignore" });
    let ws;
    for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let n = 0; const wait = new Map(); const events = [];
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id)); else if (m.method) events.push(m); });
    const send = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
    const body = () => evaluate("document.body.innerText").then(String);
    const click = (text) => evaluate(`(() => { const els=[...document.querySelectorAll('[role=checkbox],[role=button],[role=radio],button,div,a')].filter(e=>e.innerText&&e.innerText.trim()===${JSON.stringify(text)}); const e=els[els.length-1]; if(!e) return false; e.click(); return true; })()`);
    // Type into the input whose label (the text just before it) is `label`.
    const type = async (label, text) => {
      const found = await evaluate(`(() => { const ins=[...document.querySelectorAll('input')]; const i=ins.find(x=>{ let n=x; for(let k=0;k<4&&n;k++){ n=n.parentElement; if(n&&n.innerText&&n.innerText.trim().startsWith(${JSON.stringify(label)})) return true;} return false; }); if(!i) return false; i.focus(); return true; })()`);
      if (!found) throw new Error(`no field "${label}"`);
      await send("Input.insertText", { text });
      await sleep(150);
    };
    // A dropdown (UI pass 1's date of birth): open the box by its placeholder, then tap
    // the option in the sheet that opens.
    const choose = async (box, option) => {
      if (!(await click(box))) throw new Error(`no dropdown "${box}"`);
      await sleep(300);
      if (!(await click(option))) throw new Error(`no option "${option}" in "${box}"`);
      await sleep(200);
    };
    // SHOTS=<dir> keeps a screenshot of each A27 step, for comparing with the mockups.
    const snap = async (name) => {
      if (!process.env.SHOTS) return;
      mkdirSync(process.env.SHOTS, { recursive: true });
      const h = await evaluate("document.documentElement.scrollHeight");
      await send("Emulation.setDeviceMetricsOverride", { width: 393, height: Math.min(Math.max(h, 852), 4000), deviceScaleFactor: 2, mobile: true });
      await sleep(400);
      writeFileSync(join(process.env.SHOTS, `${kind}-${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
    };
    // A27 ends on "How do you want to meet?" (073, UI pass 1): the 1-on-1 switch, the same as
    // Settings; Done goes on to A9. The fresh walk turns it on and reads it back.
    const finishA27 = async () => {
      await click(OPTIN_COPY.finish);
      step("A27 ends on 'How do you want to meet?'", await until(ONE_ON_ONE_COPY.sheetTitle, 20000));
      step("…with the 1-on-1 switch", await until(ONE_ON_ONE_COPY.switchLabel));
      if (kind === "fresh") {
        await evaluate(`(() => { const s=[...document.querySelectorAll('[role=switch]')].find(e=>e.innerText.includes(${JSON.stringify(ONE_ON_ONE_COPY.switchLabel)})); s && s.click(); return !!s; })()`);
        let on = false;
        for (let t = 0; t < 20 && !on; t++) {
          await sleep(500);
          // Per event since round 3 (item 10): this crowd's pin, not the account.
          const [pin] = await must(await rest(`/rest/v1/pins?gathering_id=eq.${crowd.id}&select=solo_opt_in,people!inner(auth_user_id)&people.auth_user_id=eq.${anonId}`), "the switch");
          on = pin?.solo_opt_in === true;
        }
        step("…which switches 1-on-1 on for this event", on);
      }
      await click(ONE_ON_ONE_COPY.done);
      for (let t = 0; t < 30; t++) { if ((await evaluate("location.pathname")) === `/crowd/${crowd.slug}`) break; await sleep(500); }
    };
    const until = async (text, ms = 15000) => {
      for (let t = 0; t < ms; t += 500) { if ((await body()).includes(text)) return true; await sleep(500); }
      return false;
    };
    const step = (name, ok) => { result[name] = ok; log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) throw new Error(`stopped at: ${name}`); };

    await send("Page.enable");
    await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1600, deviceScaleFactor: 2, mobile: true });
    // The returning person is walked on an iPhone's Safari in the acceptance list: the page
    // gets Safari's user agent here, and a fresh profile is the cleared browser. (What
    // Chrome cannot copy is Safari's own 7-day deletion — the cleared profile stands in.)
    if (kind === "returning" && process.env.PIND_UA !== "off") await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
    await send("Page.setInterceptFileChooserDialog", { enabled: true });
    await send("Network.setCookie", { name: "pind_pin", value: cookie, domain: new URL(SITE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });

    // A26 in the app: pin in, ticking "meet up".
    await send("Page.navigate", { url: `${SITE}/pin/${crowd.slug}` });
    const opened = await until(QUICKPIN_COPY.meetUp);
    if (!opened) log((await body()).slice(0, 600));
    step("A26 opens", opened);
    await type(QUICKPIN_COPY.firstName, "Walker");
    await click(QUICKPIN_COPY.meetUp);
    await click(QUICKPIN_COPY.nineteen);
    await click(QUICKPIN_COPY.submit);
    step("You're in, with the primary button", await until(QUICKPIN_COPY.nextDetails));

    if (kind === "a1") {
      const pins = async () => (await must(await rest(`/rest/v1/pins?gathering_id=eq.${crowd.id}&select=id`), "pins")).length;
      step("the anonymous pin counts once more, as it did for Tatiana", (await pins()) === pinnedBefore + 1);
      await send("Page.navigate", { url: `${SITE}/crowds` });
      step("Crowds offers 'Set Up Your Profile' to the anonymous pinner", await until(PROFILE_OFFER.button, 20000));
      await click(PROFILE_OFFER.button);
      step("A1 opens", await until("Email me a code", 20000));
      await type("Email me a code", email);
      await click("Send the code");
      step("A1 names the existing account — the merge, not a sign-in over the pin", await until(OPTIN_COPY.emailHasAccount));
      const link = await must(await rest("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) }), "mint a code");
      await type(CODE_SENT_TO(email), link.email_otp ?? link.properties?.email_otp);
      await click("Continue");
      for (let t = 0; t < 40; t++) { if ((await evaluate("location.pathname")) === "/you") break; await sleep(500); }
      step("on to the profile step", (await evaluate("location.pathname")) === "/you");
      step("the crowd counts what it counted before the second device", (await pins()) === pinnedBefore);
      const [acct] = await must(await rest(`/rest/v1/people?auth_user_id=eq.${accountId}&select=id`), "account person");
      const mine = await must(await rest(`/rest/v1/pins?gathering_id=eq.${crowd.id}&person_id=eq.${acct.id}&select=id`), "account pin");
      step("one pin, the account's", mine.length === 1);
      const anon = await must(await rest(`/rest/v1/people?auth_user_id=eq.${anonId}&select=id`), "anonymous person");
      step("the anonymous person is gone, not left behind", anon.length === 0);
      step("the merge recorded itself: email, web, at the sign-in step", JSON.stringify(await mergeRecord(accountId)) === JSON.stringify([{ method: "email", platform: "web", via: "sign_in_step" }]));
      ws.close();
      return true;
    }

    await click(QUICKPIN_COPY.nextDetails);

    if (kind === "returning") {
      step("'Already on Pin'd? Sign in' is at the top", await until(OPTIN_COPY.alreadyOnPind));
      await click(OPTIN_COPY.signIn);
      step("it goes straight to signing in", await until("Email me a code", 15000));
      await type("Email me a code", email);
      await click("Send the code");
      step("the existing account is named", await until(OPTIN_COPY.emailHasAccount));
      const link = await must(await rest("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) }), "mint a code");
      await type(CODE_SENT_TO(email), link.email_otp ?? link.properties?.email_otp);
      await click("Continue");
      step("straight to the safety sheet — nothing asked again", await until(OPTIN_COPY.safetyHeading, 25000));
      step("never shown a date-of-birth field", !(await body()).includes("Date of birth"));
      step("the merge recorded itself: email, web, through 'Already on Pin'd?'", JSON.stringify(await mergeRecord(accountId)) === JSON.stringify([{ method: "email", platform: "web", via: "already_on_pind" }]));
      await click(OPTIN_COPY.accept);
      await sleep(300);
      await finishA27();
      step("lands on A9", (await evaluate("location.pathname")) === `/crowd/${crowd.slug}`);
      step("…in the room: A9 offers it, nothing asked again", await (async () => { for (let t = 0; t < 40; t++) { if (/\d+ (people |person )?in the room/.test(await body())) return true; await sleep(500); } return false; })());
      // The second pin: another gathering, one tap.
      const [second] = await must(await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: `Second pin ${Date.now()}`, starts_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), venue_id: (await must(await rest(`/rest/v1/gatherings?slug=eq.${crowd.slug}&select=venue_id`), "venue"))[0].venue_id, published_at: new Date().toISOString(), source: "manual" }) }), "second gathering");
      secondGathering = second.id;
      const slug2 = await must(await rest("/rest/v1/rpc/admin_mint_slug", { method: "POST", body: JSON.stringify({ p_gathering: second.id }) }), "slug");
      await send("Page.navigate", { url: `${SITE}/pin/${slug2}` });
      step("the second pin opens", await until(QUICKPIN_COPY.meetUp));
      const pinPage = await body();
      step("the second pin asks no 19+ tick", !pinPage.includes(QUICKPIN_COPY.nineteen));
      await click(QUICKPIN_COPY.submit);
      for (let t = 0; t < 30; t++) { if ((await evaluate("location.pathname")) === `/crowd/${slug2}`) break; await sleep(500); }
      step("one tap: straight to the crowd page", (await evaluate("location.pathname")) === `/crowd/${slug2}`);
      const [pin2] = await must(await rest(`/rest/v1/pins?gathering_id=eq.${second.id}&select=open_to_meeting`), "pin2");
      step("…open to meeting, so in the room", pin2?.open_to_meeting === true);
      ws.close();
      return true;
    }

    // A27 "you": date of birth first, gender, the photo through the real picker.
    step("A27 asks date of birth first", await until("Date of birth"));
    const firstName = await evaluate(`[...document.querySelectorAll('input')][0]?.value`);
    step("A27 carries the first name from the pin", firstName === "Walker");
    await snap("a27-you");
    await choose("Month", "June");
    await choose("Day", "14");
    await choose("Year", "1995");
    await click("Woman");
    events.length = 0;
    await click("Choose a photo");
    let chooser;
    for (let t = 0; t < 20 && !chooser; t++) { await sleep(250); chooser = events.find((e) => e.method === "Page.fileChooserOpened"); }
    step("the photo picker opens", !!chooser);
    await send("DOM.setFileInputFiles", { files: [PHOTO], backendNodeId: chooser.params.backendNodeId });
    step("the photo is chosen", await until("Remove photo"));
    await click("Next");

    // "where": a neighbourhood and three tags.
    step("A27 asks where, after you", await until("Where in the city?", 20000));
    step("Skip is offered", (await body()).includes("Skip for now"));
    if (kind === "skip") {
      await click("Skip for now");
    } else {
      // Two pages since UI pass 1: the neighbourhood, then the tags.
      await click(HOOD.name);
      await snap("a27-where");
      await click("Next");
      step("A27 asks for tags on their own page", await until("A few things to say"));
      for (const t of TAGS) await click(t.name);
      await sleep(300);
      step("the live count says how many of ten", (await body()).includes(`${TAGS.length} of 10`));
      await snap("a27-tags");
      await click("Next");
    }

    // "identity": Apple and Google offered; the email code names its address.
    step("A27 asks for a way to sign in", await until(OPTIN_COPY.contactHeading, 20000));
    const idPage = await body();
    step("Apple and Google are offered at A27", idPage.includes("Continue with Apple") && idPage.includes("Continue with Google"));
    if (kind === "fresh") {
      // Each button starts a LINK with its provider (the same user gains the identity):
      // the page must leave for Google's and Apple's own sign-in, then come back to A27.
      for (const [label, host] of [["Continue with Google", "accounts.google.com"], ["Continue with Apple", "appleid.apple.com"]]) {
        await click(label);
        let at = "";
        for (let t = 0; t < 30 && !at.includes(host); t++) { await sleep(500); at = String(await evaluate("location.host")); }
        step(`${label} leaves for ${host}`, at.includes(host));
        await send("Page.navigate", { url: `${SITE}/opt-in/${crowd.slug}` });
        step(`back on A27 after ${host}, still at the sign-in step`, await until(OPTIN_COPY.contactHeading, 20000));
      }
    }
    await type("Email me a code", email);
    await click("Send the code");
    step("the code step names the address", await until(CODE_SENT_TO(email)));

    if (kind !== "merge") {
      // The code went to a simulated inbox; confirm the address the way the code would.
      await must(await rest(`/auth/v1/admin/users/${anonId}`, { method: "PUT", body: JSON.stringify({ email, email_confirm: true }) }), "confirm address");
      // A real code returns a fresh session at once; the admin shortcut does not, so the
      // stored token (still saying "anonymous") is expired to make the page refresh it.
      await evaluate(`(() => { const k=Object.keys(localStorage).find(k=>k.endsWith('-auth-token')); const s=JSON.parse(localStorage.getItem(k)); s.expires_at=0; localStorage.setItem(k, JSON.stringify(s)); })()`);
      await send("Page.reload");
    } else {
      step("the existing account is named", (await body()).includes(OPTIN_COPY.emailHasAccount));
      const link = await must(await rest("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) }), "mint a code");
      const otp = link.email_otp ?? link.properties?.email_otp;
      await type(CODE_SENT_TO(email), otp);
      await click("Continue");
    }

    // After signing in — as whoever this now is — the test crowd must still be there.
    // This is the step Alex could never get past (M3.2 walk, 28 Sept).
    step("the safety sheet", await until(OPTIN_COPY.safetyHeading, 25000));
    const afterSignIn = await body();
    step("after sign-in the test crowd is still visible", afterSignIn.includes("Test crowd") && !afterSignIn.includes("isn't open to the account") && !afterSignIn.includes("Not on Pin'd"));
    await click(OPTIN_COPY.accept);
    await sleep(300);
    await finishA27();
    step("lands on A9", (await evaluate("location.pathname")) === `/crowd/${crowd.slug}`);
    step("A9 shows the test crowd, not 'Not on Pin'd'", (await until("Test crowd", 15000)) && !(await body()).includes("Not on Pin'd"));

    // What the database holds now, for whoever this ended up as.
    const who = kind === "merge" ? accountId : anonId;
    if (kind === "merge") {
      step("the merge recorded itself: email, web, at the sign-in step", JSON.stringify(await mergeRecord(accountId)) === JSON.stringify([{ method: "email", platform: "web", via: "sign_in_step" }]));
    }
    const [p] = await must(await rest(`/rest/v1/people?auth_user_id=eq.${who}&select=id,first_name,photo_path,neighbourhood`), "person");
    const priv = await must(await rest(`/rest/v1/people_private?person_id=eq.${p.id}&select=gender,birth_year`), "private");
    const tags = await must(await rest(`/rest/v1/person_tags?person_id=eq.${p.id}&select=tag`), "tags");
    const [pin] = await must(await rest(`/rest/v1/pins?person_id=eq.${p.id}&gathering_id=eq.${crowd.id}&select=open_to_meeting`), "pin");
    step("open to meeting", pin?.open_to_meeting === true);
    step("the photo is in this account's own folder", !!p.photo_path && p.photo_path.startsWith(`${who}/`));
    step("date of birth and gender kept", priv[0]?.gender === "woman" && priv[0]?.birth_year === 1995);
    if (kind === "skip") {
      // Skipped "where": Profile must say what is missing, with a way to each, and the
      // neighbourhood must be settable from there (Alex, M3.2: items 1 and 2).
      step("skipped: no neighbourhood, no tags", !p.neighbourhood && tags.length === 0);
      await send("Page.navigate", { url: `${SITE}/me` });
      const line = profileGapLine(profileGaps({ hasPhoto: true, neighbourhood: null, tagCount: 0 }), 0);
      step("Profile names what is missing", await until(line, 20000));
      const me = await body();
      step("Profile offers a way to each", me.includes(PROFILE_GAP_ACTION.neighbourhood) && me.includes(PROFILE_GAP_ACTION.tags));
      await click(PROFILE_GAP_ACTION.neighbourhood);
      // The heading draws before the picker has loaded: wait for the chips themselves.
      step("the neighbourhood editor opens", (await until("Your neighbourhood", 15000)) && (await until(HOOD.name, 15000)));
      await click(HOOD.name);
      await click("Save");
      const after = profileGapLine(profileGaps({ hasPhoto: true, neighbourhood: HOOD.slug, tagCount: 0 }), 0);
      const back = await until(after, 20000);
      if (!back) log(`page: ${await evaluate("location.pathname")} ${JSON.stringify((await body()).slice(0, 300))}`);
      const [saved] = await must(await rest(`/rest/v1/people?id=eq.${p.id}&select=neighbourhood`), "person saved");
      if (!back) log(`database: neighbourhood=${saved.neighbourhood}`);
      step("back on Profile, the neighbourhood is no longer missing", back);
      const [again] = await must(await rest(`/rest/v1/people?id=eq.${p.id}&select=neighbourhood`), "person again");
      step("the neighbourhood saved from Profile", again.neighbourhood === HOOD.slug);
    } else {
      step("the neighbourhood kept", p.neighbourhood === HOOD.slug);
      step("the three tags kept", tags.map((t) => t.tag).sort().join() === TAGS.map((t) => t.slug).sort().join());
      step("nothing missing on Profile", profileGaps({ hasPhoto: !!p.photo_path, neighbourhood: p.neighbourhood, tagCount: tags.length }).length === 0);
    }
    ws.close();
    return true;
  } catch (err) {
    log(String(err.message ?? err));
    return false;
  } finally {
    chrome?.kill();
    if (secondGathering) await rest(`/rest/v1/gatherings?id=eq.${secondGathering}`, { method: "DELETE" });
    for (const id of made) {
      // A test merge's record never stays in the table §7 counts from.
      const [person] = await (await rest(`/rest/v1/people?auth_user_id=eq.${id}&select=id`)).json().catch(() => []);
      if (person?.id) await rest(`/rest/v1/account_merges?person_id=eq.${person.id}`, { method: "DELETE" });
      const files = await (await fetch(`${base}/storage/v1/object/list/photos`, { method: "POST", headers: { ...S, "content-type": "application/json" }, body: JSON.stringify({ prefix: `${id}/`, limit: 100 }) })).json().catch(() => []);
      const paths = (Array.isArray(files) ? files : []).filter((f) => f.id).map((f) => `${id}/${f.name}`);
      if (paths.length) await fetch(`${base}/storage/v1/object/photos`, { method: "DELETE", headers: { ...S, "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
      await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: id, p_on: false, p_actor: "link-path-check" }) }).catch(() => undefined);
      await rest(`/rest/v1/people?auth_user_id=eq.${id}`, { method: "DELETE" });
      await rest(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
    }
  }
}

const which = process.argv[2] ? [process.argv[2]] : ["fresh", "merge", "skip", "returning", "a1"];
let ok = true;
for (const kind of which) ok = (await walk(kind)) && ok;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
