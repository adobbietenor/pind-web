// Who is signed in on this device — the one place the app asks (M3.1).
//
// **Never `auth.getUser()` for this.** It is a network call, and offline it answers
// `user: null`, which every screen read as "signed out": A2 told Alex "We lost your
// sign-in" in airplane mode with a session that was fine. The session is read from the
// device instead, and the answer is classified by `readSession` in `@pind/shared`,
// where N01–N09 prove an unreachable server is never called a lost sign-in.
// `screens.test.ts` (S16) fails if anything in the app calls `getUser()` again.
import { Platform } from "react-native";
import { readSession, type SessionRead } from "@pind/shared";
import { supabase } from "./supabase";

// **The quick pin's hand-off** (M3.2). On the web, A26 is the Worker's: it signs a
// stranger in anonymously and keeps the session in a sealed, HttpOnly cookie. The
// first time the app asks who is signed in, it claims that session once
// (`POST /session/claim`, same origin) and installs it with supabase-js's own
// `setSession` — nothing writes supabase-js's storage by hand. Done here, inside
// whoAmI, so no screen can read "signed out" in the moment before the claim lands.
let claim: Promise<void> | null = null;

function claimOnce(): Promise<void> {
  if (Platform.OS !== "web" || typeof window === "undefined") return Promise.resolve();
  claim ??= (async () => {
    const db = supabase();
    const { data } = await db.auth.getSession();
    if (data.session) return;
    const res = await fetch("/session/claim", { method: "POST", credentials: "same-origin" });
    if (res.status !== 200) return;
    const tokens = (await res.json()) as { access_token: string; refresh_token: string };
    await db.auth.setSession(tokens);
  })().catch(() => {
    // Offline, or the cookie had lapsed: whoAmI reads what the device has, and says so.
  });
  return claim;
}

export async function whoAmI(): Promise<SessionRead> {
  await claimOnce();
  try {
    const { data, error } = await supabase().auth.getSession();
    return readSession(data.session, error);
  } catch (err) {
    return readSession(null, err);
  }
}

// Thrown by anything that needs a signed-in person and did not get one, carrying the
// reason — so the screen can say which of the three it was and offer the right exit.
export class SessionProblem extends Error {
  constructor(readonly read: Exclude<SessionRead, { state: "in" }>) {
    super(`session ${read.state}`);
    this.name = "SessionProblem";
  }
}

export async function myAuthId(): Promise<string> {
  const read = await whoAmI();
  if (read.state !== "in") throw new SessionProblem(read);
  return read.userId;
}
