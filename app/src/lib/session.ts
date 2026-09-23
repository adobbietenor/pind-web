// Who is signed in on this device — the one place the app asks (M3.1).
//
// **Never `auth.getUser()` for this.** It is a network call, and offline it answers
// `user: null`, which every screen read as "signed out": A2 told Alex "We lost your
// sign-in" in airplane mode with a session that was fine. The session is read from the
// device instead, and the answer is classified by `readSession` in `@pind/shared`,
// where N01–N09 prove an unreachable server is never called a lost sign-in.
// `screens.test.ts` (S16) fails if anything in the app calls `getUser()` again.
import { readSession, type SessionRead } from "@pind/shared";
import { supabase } from "./supabase";

export async function whoAmI(): Promise<SessionRead> {
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
