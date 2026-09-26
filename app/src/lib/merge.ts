// Bringing an anonymous pinner into the account they already have (A27, M3.2).
//
// The design Alex approved: nothing moves until the account's own sign-in proves it —
// an email code, or Apple or Google (M3.2 walk: "move them up") — and then BOTH sessions
// go to the Worker (`POST /account/merge`), which checks each with the auth server
// before anything moves. The anonymous session is held until then, and put back on any
// failure, so "your pin is still there" is true, not just said.
//
// On the web, Apple and Google leave the page and come back, so the held session
// cannot live in memory: it waits in sessionStorage (this tab only, cleared on use)
// under HELD_KEY, and A27 finishes the merge when the page returns.

import { Platform } from "react-native";
import { supabase } from "./supabase";

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";
const WORKER = Platform.OS === "web" ? "" : SITE;
const HELD_KEY = "pind.merge.held";

export interface Held {
  access_token: string;
  refresh_token: string;
}

// The anonymous session, as it is right now — taken before signing in to the account.
export async function holdAnonymous(): Promise<Held | null> {
  const { data } = await supabase().auth.getSession();
  const s = data.session;
  if (!s || !s.user.is_anonymous) return null;
  return { access_token: s.access_token, refresh_token: s.refresh_token };
}

// A held session may be an hour old by the time it is used (the web round trip): swap
// its refresh token for a fresh pair WITHOUT installing it, so the account's session
// stays the signed-in one.
async function fresh(held: Held): Promise<Held> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return held;
  const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: held.refresh_token }),
  }).catch(() => null);
  if (!res?.ok) return held;
  const t = (await res.json()) as { access_token?: string; refresh_token?: string };
  return t.access_token && t.refresh_token ? { access_token: t.access_token, refresh_token: t.refresh_token } : held;
}

// With the ACCOUNT signed in and the anonymous session held: the merge. On any failure
// the anonymous session is put back and this throws — the pin is exactly where it was.
export async function mergeHeld(held: Held): Promise<void> {
  const db = supabase();
  const { data } = await db.auth.getSession();
  const account = data.session;
  try {
    if (!account || account.user.is_anonymous) throw new Error("merge: the account is not signed in");
    const anon = await fresh(held);
    const res = await fetch(`${WORKER}/account/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${account.access_token}` },
      body: JSON.stringify({ anon_access_token: anon.access_token }),
    });
    if (!res.ok) throw Object.assign(new Error(`merge ${res.status}`), { status: res.status });
  } catch (err) {
    await db.auth.setSession(held).catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The web's round trip
// ---------------------------------------------------------------------------

export type Provider = "apple" | "google";

export function stashForMerge(held: Held): void {
  try {
    sessionStorage.setItem(HELD_KEY, JSON.stringify(held));
  } catch {
    // No storage: the merge cannot survive the redirect. The caller says so.
    throw new Error("session storage unavailable");
  }
}

function takeStash(): Held | null {
  try {
    const raw = sessionStorage.getItem(HELD_KEY);
    sessionStorage.removeItem(HELD_KEY);
    return raw ? (JSON.parse(raw) as Held) : null;
  } catch {
    return null;
  }
}

// What a return from Apple or Google left in the address bar: `linking=<provider>`, our
// own marker, and the auth server's error code if the link was refused. Read and then
// removed, so a refresh does not act on it twice.
function readReturn(): { linking: Provider | null; errorCode: string | null } {
  if (Platform.OS !== "web" || typeof window === "undefined") return { linking: null, errorCode: null };
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const linking = url.searchParams.get("linking");
  const errorCode = url.searchParams.get("error_code") ?? hash.get("error_code");
  if (linking || errorCode || url.searchParams.has("error")) {
    for (const k of ["linking", "error", "error_code", "error_description"]) url.searchParams.delete(k);
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : ""));
  }
  return { linking: linking === "apple" || linking === "google" ? linking : null, errorCode };
}

export type WebReturn =
  | { kind: "none" }
  | { kind: "merged" }
  | { kind: "merge-failed" }
  // Apple or Google already belongs to an account: offer to bring the pin into it.
  | { kind: "has-account"; provider: Provider }
  | { kind: "link-failed"; provider: Provider | null };

// Called by A27 before it reads anything: finish a merge the page left to go and sign
// in for, or report how a link attempt came back.
export async function finishWebReturn(): Promise<WebReturn> {
  if (Platform.OS !== "web") return { kind: "none" };
  const back = readReturn();
  const held = takeStash();
  if (held) {
    try {
      await mergeHeld(held);
      return { kind: "merged" };
    } catch {
      return { kind: "merge-failed" };
    }
  }
  // Already an account: the identity itself (identity_already_exists), or its email
  // address belongs to one made with the email code (email_exists). Either way, signing
  // in with that provider reaches the account, so the merge is what is offered.
  if ((back.errorCode === "identity_already_exists" || back.errorCode === "email_exists") && back.linking) {
    return { kind: "has-account", provider: back.linking };
  }
  if (back.errorCode) return { kind: "link-failed", provider: back.linking };
  return { kind: "none" };
}
