// Whether this device is signed in — and the three answers that are NOT "yes" (M3.1).
//
// **An unreachable server is not a lost session.** Alex's airplane-mode walk on A2
// was told "We lost your sign-in. Go back and sign in again" with a session that was
// fine. Every screen asked `auth.getUser()`, which is a NETWORK call: offline it hands
// back `user: null` with an `AuthRetryableFetchError`, and every caller read the null
// and threw the error away. The third time a failure was named as the wrong failure
// (after "expired" for a session that never existed, and "expired code" for a stale
// session) — an instrument answering confidently and wrongly (CLAUDE.md).
//
// So the rule is:
//
//   * **Who you are is read from this device** (`getSession`), which needs no network
//     while the token is fresh. The id is only used to name your folder and rows; the
//     server checks the token on every write, so reading it locally trusts nothing.
//   * **"Out" is said only on proof**: no session stored, or the auth server saying
//     the session is gone. Anything that failed to arrive is "unreachable", and an
//     error nobody recognises is "unsure" with its own message — never "out".
//
// The sentences are here too, and each one has a way out attached where it is shown
// (`Trouble` in the app): out → Sign in; unreachable and unsure → Try again.

export type SessionRead =
  | { state: "in"; userId: string }
  | { state: "out" }
  | { state: "unreachable" }
  | { state: "unsure"; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// **One rule for "the request never got there"**, used by the session read and by
// every other failure sentence in the app (errors.ts). React Native says "Network
// request failed", Chrome "Failed to fetch", Safari "Load failed"; auth-js wraps all
// three, and a 502/503/504, as AuthRetryableFetchError.
export function isUnreachable(err: unknown): boolean {
  if (!isRecord(err)) return false;
  if (err.name === "AuthRetryableFetchError") return true;
  const message = typeof err.message === "string" ? err.message : "";
  return /failed to fetch|network request failed|load failed|network error|internet connection appears to be offline/i.test(message);
}

// What proves the session is gone: nothing stored, or the auth server refusing it.
function isSignedOut(err: unknown): boolean {
  if (!isRecord(err)) return false;
  if (err.name === "AuthSessionMissingError") return true;
  // A refresh token the server no longer knows ("Invalid Refresh Token: …") — the
  // same reading `isStaleSession` makes at sign-in.
  const message = typeof err.message === "string" ? err.message : "";
  if (/refresh token/i.test(message)) return true;
  return err.status === 401 || err.status === 403;
}

export function readSession(session: { user: { id: string } } | null | undefined, error: unknown): SessionRead {
  // Unreachable first: a session that could not be refreshed offline comes back as
  // null WITH a retryable error, and the null is the part that lies.
  if (error && isUnreachable(error)) return { state: "unreachable" };
  if (session?.user?.id) return { state: "in", userId: session.user.id };
  if (!error || isSignedOut(error)) return { state: "out" };
  const message = isRecord(error) && typeof error.message === "string" ? error.message : String(error);
  return { state: "unsure", message };
}

export const SESSION_OUT = "You are signed out on this device. Sign in again to carry on.";
export const SESSION_UNREACHABLE =
  "Pin'd could not be reached. Check your connection and try again — you have not been signed out, and nothing here was lost.";
// The message stays on the read for Sentry, never in the sentence (said.ts).
export const SESSION_UNSURE = "We could not check your sign-in just now. Try again in a moment.";

export function sessionSays(read: Exclude<SessionRead, { state: "in" }>): string {
  if (read.state === "out") return SESSION_OUT;
  if (read.state === "unreachable") return SESSION_UNREACHABLE;
  return SESSION_UNSURE;
}

// The way out each sentence promises. A screen that says "sign in again" and offers
// no button to do it is a dead end (Alex, the same walk).
export function sessionWayOut(read: Exclude<SessionRead, { state: "in" }>): "sign-in" | "retry" {
  return read.state === "out" ? "sign-in" : "retry";
}
