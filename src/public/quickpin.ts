// A26 — the quick pin, rendered by the Worker (Alex, M3.2; spec §4's restated rule:
// everything a stranger meets before they have committed is the Worker, including
// the one form that commits them).
//
// Why here and not in Expo, measured: the Expo A26, after every cut that worked, drew
// its content at 3.8 s and was usable at 5.6 s against W2's 1.6–2.2 s. This page is a
// plain HTML form with W2's look and weight.
//
// **What it does, and the one thing it may do that no other Worker page does:**
//   GET   the form. No session, nothing about anyone.
//   POST  signs the visitor in ANONYMOUSLY (once — a returning browser's sealed cookie
//         is reused), then writes their person, their 19+ record and their pin **as
//         that user, with the publishable key and their own token**. RLS decides every
//         write exactly as it does for the app (H11); no service key, no people read.
//         The session goes into a sealed HttpOnly cookie (sealed.ts), which the app
//         claims once (`claimSession`) and installs with supabase-js's own setSession.
//
// **The fields, words and validation are not here** — they are
// `@pind/shared/quickpin.ts`, shared with the app's A26, and tests/unit/quickpin.test.ts
// (Q04) fails if this file writes its own.
//
// **Without JavaScript it still pins** (a plain form POST), and the page that comes
// back says so plainly: the session waits in the cookie and the next visit with script
// on claims it (Alex: never a silent dead end).

import {
  PARTY_CHOICES,
  QUICKPIN_COPY,
  QUICKPIN_FIELDS,
  quickPinPlace,
  quickPinProgress,
  readQuickPin,
  supabaseStorageKey,
  THRESHOLD,
  type QuickPinDb,
  type QuickPinInput,
  writeQuickPin,
} from "@pind/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { ConfigError, projectUrl } from "../supabase";
import { crowd, type Crowd2 } from "./data";
import { DOT, escape, header, notice, page } from "./layout";
import { clearPinCookie, PIN_COOKIE, pinCookie, readCookie, seal, unseal } from "./sealed";


function publishableKey(env: Env): string {
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key?.startsWith("sb_publishable_")) throw new ConfigError("SUPABASE_PUBLISHABLE_KEY is missing or not a publishable key");
  return key;
}

function sessionSecret(env: Env): string {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) throw new ConfigError("SESSION_SECRET is not set — the quick pin cannot keep a visitor's session");
  return secret;
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

const FORM_CSS = `
form.qp{margin:18px 0 0}
.qp .field{margin:0 0 20px}
.qp label.l{display:block;font-weight:600;margin:0 0 7px}
.qp .hint{display:block;font-size:.86rem;color:var(--muted);margin:6px 0 0}
.qp input[type=text],.qp input[type=number]{width:100%;box-sizing:border-box;padding:14px 14px;font:inherit;font-size:1.05rem;
  color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:12px}
.qp input[type=text]:focus,.qp input[type=number]:focus{outline:2px solid var(--accent-lift);outline-offset:1px;border-color:var(--accent-lift)}
.qp .who{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;border:0;padding:0;margin:0}
.qp .who legend{font-weight:600;margin:0 0 7px;padding:0}
.qp .who input{position:absolute;opacity:0;pointer-events:none}
.qp .who label{display:block;text-align:center;padding:13px 8px;border:1px solid var(--border);border-radius:12px;background:var(--surface);cursor:pointer}
.qp .who input:checked+label{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
.qp .who input:focus-visible+label{outline:2px solid var(--accent-lift);outline-offset:2px}
.qp .group{display:none;margin-top:10px}
.qp .who:has(input[value=group]:checked)~.group,.qp .group.show{display:block}
.qp .tick{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface);margin:0 0 10px;cursor:pointer}
.qp .tick input{width:22px;height:22px;margin:1px 0 0;accent-color:var(--accent);flex:none}
.qp .err{display:block;color:#ff9aa9;font-size:.9rem;margin:7px 0 0}
.qp .field.bad input[type=text],.qp .field.bad input[type=number]{border-color:#e06b6b}
.done .place{font-size:1.5rem;font-weight:700;margin:6px 0 4px}
.done .links{display:flex;flex-direction:column;gap:10px;margin:22px 0 0}
.done .links a{display:block;text-align:center;padding:13px;border:1px solid var(--border);border-radius:12px;color:var(--text);text-decoration:none}
`;

interface FormState {
  values: QuickPinInput;
  error?: { field: string; says: string };
  banner?: string;
}

function fieldError(state: FormState, field: string): string {
  return state.error?.field === field ? `<span class="err" role="alert">${escape(state.error.says)}</span>` : "";
}

function form(door: Crowd2, state: FormState): string {
  const g = door.gathering;
  const v = state.values;
  const party = v[QUICKPIN_FIELDS.party] ?? "1";
  const bad = (field: string) => (state.error?.field === field ? " bad" : "");
  const choices = PARTY_CHOICES.map(
    (c, i) =>
      `<input type="radio" id="p${i}" name="${QUICKPIN_FIELDS.party}" value="${c.value}"${party === c.value ? " checked" : ""}><label for="p${i}">${escape(c.label)}</label>`,
  ).join("");

  return `${header()}
<h1>${escape(QUICKPIN_COPY.heading)}</h1>
<p class="lede">${escape(g.name)}${DOT}${escape(door.venue.name)}</p>
${state.banner ? `<p class="err" role="alert">${escape(state.banner)}</p>` : ""}
<form class="qp" method="post" action="/g/${escape(g.slug)}/pin" novalidate>
  <div class="field${bad(QUICKPIN_FIELDS.firstName)}">
    <label class="l" for="fn">${escape(QUICKPIN_COPY.firstName)}</label>
    <input type="text" id="fn" name="${QUICKPIN_FIELDS.firstName}" value="${escape(v[QUICKPIN_FIELDS.firstName] ?? "")}" maxlength="40" autocomplete="given-name" autocapitalize="words" enterkeyhint="next" required>
    <span class="hint">${escape(QUICKPIN_COPY.firstNameHint)}</span>
    ${fieldError(state, QUICKPIN_FIELDS.firstName)}
  </div>
  <div class="field${bad(QUICKPIN_FIELDS.party)}${bad(QUICKPIN_FIELDS.groupSize)}">
    <fieldset class="who"><legend>${escape(QUICKPIN_COPY.party)}</legend>${choices}</fieldset>
    <div class="group${party === "group" ? " show" : ""}">
      <label class="l" for="gs">${escape(QUICKPIN_COPY.groupSize)}</label>
      <input type="number" id="gs" name="${QUICKPIN_FIELDS.groupSize}" value="${escape(v[QUICKPIN_FIELDS.groupSize] ?? "")}" min="2" max="10" inputmode="numeric">
    </div>
    ${fieldError(state, QUICKPIN_FIELDS.party)}${fieldError(state, QUICKPIN_FIELDS.groupSize)}
  </div>
  <div class="field">
    <label class="tick"><input type="checkbox" name="${QUICKPIN_FIELDS.meetUp}"${v[QUICKPIN_FIELDS.meetUp] ? " checked" : ""}><span>${escape(QUICKPIN_COPY.meetUp)}<span class="hint">${escape(QUICKPIN_COPY.meetUpHint)}</span></span></label>
  </div>
  <div class="field${bad(QUICKPIN_FIELDS.nineteen)}">
    <label class="tick"><input type="checkbox" name="${QUICKPIN_FIELDS.nineteen}"${v[QUICKPIN_FIELDS.nineteen] ? " checked" : ""}><span>${escape(QUICKPIN_COPY.nineteen)}</span></label>
    ${fieldError(state, QUICKPIN_FIELDS.nineteen)}
  </div>
  <button class="cta" type="submit">${escape(QUICKPIN_COPY.submit)}</button>
</form>`;
}

// Someone already signed in on this browser pins as themselves, in the app's A26 —
// never as a second anonymous user. The page reads only WHETHER a session exists
// under supabase-js's key (Q02 derives it), never what is in it.
function signedInScript(env: Env, slug: string): string {
  const key = supabaseStorageKey(projectUrl(env));
  return `try{if(localStorage.getItem(${JSON.stringify(key)}))location.replace(${JSON.stringify(`/pin/${slug}`)})}catch(e){}`;
}

function formPage(env: Env, door: Crowd2, state: FormState, status = 200): Response {
  return page(form(door, state), {
    title: `${QUICKPIN_COPY.heading} · ${door.gathering.name} · Pin'd`,
    status,
    head: `<style>${FORM_CSS}</style>`,
    script: signedInScript(env, door.gathering.slug),
    // The form carries no one's data, so it can be cached like W2; a re-rendered form
    // with someone's answers in it never is.
    cache: status === 200 && !state.error ? "public, max-age=0, s-maxage=60" : "private, no-store",
    footer: `<a href="/g/${escape(door.gathering.slug)}">back to the crowd</a>${DOT}<a href="/privacy">privacy</a>${DOT}19+`,
  });
}

const isClosed = (door: Crowd2) => Date.now() >= Date.parse(door.gathering.effective_end);

async function openDoor(env: Env, slug: string): Promise<Crowd2 | Response> {
  const door = await crowd(env, slug);
  if (door.status === "redirect") return Response.redirect(`https://pind.social/g/${door.slug}/pin`, 301);
  if (door.status !== "ok") return notice("Not found", "That crowd is not on Pin'd.");
  return door;
}

export async function quickPinPage(env: Env, slug: string): Promise<Response> {
  const door = await openDoor(env, slug);
  if (door instanceof Response) return door;
  if (isClosed(door)) return notice(QUICKPIN_COPY.heading, QUICKPIN_COPY.closed, 410);
  return formPage(env, door, { values: {} });
}

// ---------------------------------------------------------------------------
// The pin
// ---------------------------------------------------------------------------

interface Tokens {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

async function auth(env: Env, path: string, body: unknown, visitorIp: string | null): Promise<Tokens> {
  const headers: Record<string, string> = { apikey: publishableKey(env), "content-type": "application/json" };
  // The visitor's own address for Supabase's per-IP limit is forwarded only when Alex
  // has switched IP forwarding on and approved the secret key for this one call
  // (decisions, M3.2). Until then every Worker sign-in shares Cloudflare's addresses.
  if (env.QUICKPIN_FORWARD_IP === "on" && visitorIp && env.SUPABASE_SERVICE_ROLE_KEY) {
    headers.apikey = env.SUPABASE_SERVICE_ROLE_KEY.trim();
    headers["Sb-Forwarded-For"] = visitorIp;
  }
  const res = await fetch(`${projectUrl(env)}/auth/v1/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; user?: { id?: string } };
  if (!res.ok || !json.access_token || !json.refresh_token || !json.user?.id) {
    throw new Error(`auth ${path} ${res.status}`);
  }
  return { userId: json.user.id, accessToken: json.access_token, refreshToken: json.refresh_token };
}

// One anonymous user per browser: a sealed cookie from an earlier pin is refreshed and
// reused, so pinning a second gathering does not make a second person.
async function sessionFor(env: Env, request: Request): Promise<Tokens> {
  const ip = request.headers.get("cf-connecting-ip");
  const earlier = await unseal(sessionSecret(env), readCookie(request, PIN_COOKIE));
  if (earlier) {
    try {
      return await auth(env, "token?grant_type=refresh_token", { refresh_token: earlier.refreshToken }, ip);
    } catch {
      // A stale or revoked token: fall through to a fresh anonymous user.
    }
  }
  return auth(env, "signup", { data: {} }, ip);
}

function asUser(env: Env, accessToken: string): SupabaseClient {
  return createClient(projectUrl(env), publishableKey(env), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function must<T>(q: PromiseLike<{ data: T; error: unknown }>, what: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(`${what}: ${(error as { message?: string }).message ?? "failed"}`), { cause: error });
  return data;
}

export async function quickPinSubmit(request: Request, env: Env, slug: string): Promise<Response> {
  const door = await openDoor(env, slug);
  if (door instanceof Response) return door;
  if (isClosed(door)) return notice(QUICKPIN_COPY.heading, QUICKPIN_COPY.closed, 410);

  const form = await request.formData();
  const values: QuickPinInput = {};
  for (const f of Object.values(QUICKPIN_FIELDS)) {
    const v = form.get(f);
    if (typeof v === "string") values[f] = v;
  }
  const read = readQuickPin(values);
  if (!read.ok) return formPage(env, door, { values, error: { field: read.field, says: read.says } }, 422);

  let tokens: Tokens;
  let already = false;
  try {
    tokens = await sessionFor(env, request);
    const written = await writeQuickPin(
      asUser(env, tokens.accessToken) as unknown as QuickPinDb,
      tokens.userId,
      door.gathering.id,
      read.value,
    );
    already = written.already;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    console.error("quick pin failed:", err);
    return formPage(env, door, { values, banner: QUICKPIN_COPY.tryAgain }, 503);
  }

  const counts = await must(
    asUser(env, tokens.accessToken).rpc("gathering_counts", { gathering_ids: [door.gathering.id] }),
    "counts",
  ).catch(() => null);
  const row = (counts as { pinned: number; open_to_meeting: number }[] | null)?.[0];

  const cookie = await seal(sessionSecret(env), { userId: tokens.userId, refreshToken: tokens.refreshToken, issuedAt: Date.now() });
  const res = page(done(door, already, row), {
    title: `${QUICKPIN_COPY.pinned} · ${door.gathering.name} · Pin'd`,
    head: `<style>${FORM_CSS}</style>`,
    // A same-origin marker W2's button reads to say SEE_WHO instead of PIN_IN (M3.2,
    // decided in M3.1: no network, no cookie, no cache change on W2).
    script: `try{localStorage.setItem(${JSON.stringify(`pind.pinned.${door.gathering.slug}`)},"1")}catch(e){}`,
    cache: "private, no-store",
    footer: `<a href="/">this week&#39;s crowds</a>${DOT}<a href="/privacy">privacy</a>${DOT}19+`,
  });
  res.headers.append("set-cookie", pinCookie(cookie));
  return res;
}

function done(door: Crowd2, already: boolean, counts: { pinned: number; open_to_meeting: number } | undefined): string {
  const g = door.gathering;
  return `${header()}
<div class="done">
<h1>${escape(already ? QUICKPIN_COPY.alreadyPinned : QUICKPIN_COPY.pinned)}</h1>
<p class="lede">${escape(g.name)}${DOT}${escape(door.venue.name)}</p>
${counts ? `<p class="place">${escape(quickPinPlace(counts.pinned))}</p><p class="lede">${escape(quickPinProgress(counts.open_to_meeting, THRESHOLD))}</p>` : ""}
<noscript><p class="note" style="text-align:left;margin-top:16px">${escape(QUICKPIN_COPY.noScript)}</p></noscript>
<div class="links">
<a href="/pin/${escape(g.slug)}">${escape(QUICKPIN_COPY.editOrRemove)}</a>
<a href="/g/${escape(g.slug)}">${escape(QUICKPIN_COPY.share)}</a>
<a href="/g/${escape(g.slug)}.ics">${escape(QUICKPIN_COPY.addToCalendar)}</a>
</div>
</div>`;
}

// ---------------------------------------------------------------------------
// The hand-off: the app claims the session once
// ---------------------------------------------------------------------------

// POST /session/claim, same origin only. Refreshes the sealed session (rotating its
// refresh token), returns the pair for supabase-js's own setSession, and clears the
// cookie so it is claimed exactly once.
export async function claimSession(request: Request, env: Env): Promise<Response> {
  const json = (status: number, body: unknown, extra?: Record<string, string>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
    });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json(403, { error: "cross-origin" });

  const sealed = await unseal(sessionSecret(env), readCookie(request, PIN_COOKIE));
  if (!sealed) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  try {
    const fresh = await auth(env, "token?grant_type=refresh_token", { refresh_token: sealed.refreshToken }, request.headers.get("cf-connecting-ip"));
    return json(200, { access_token: fresh.accessToken, refresh_token: fresh.refreshToken }, { "set-cookie": clearPinCookie() });
  } catch {
    return json(410, { error: "expired" }, { "set-cookie": clearPinCookie() });
  }
}
