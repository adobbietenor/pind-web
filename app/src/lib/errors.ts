// Turning whatever was thrown into a sentence somebody can act on (M3.1).
//
// **Why this exists.** A2 said "That did not save. Try again." for a permission error
// that had a precise cause, and the reason it fell through to that sentence is worth
// keeping: **a PostgREST error is not an `Error`.** It is a plain object —
// `{ code, details, hint, message }` — so `err instanceof Error` is false, and every
// `catch` that leans on `instanceof` silently discards the only useful thing it was
// handed. The same is true of Storage errors.
//
// The rule this follows is the one the session bug earned: **a message that names the
// wrong cause is worse than one that names none**, because it sends somebody to fix
// the wrong thing. So: say which step failed, in words, and keep the technical detail
// rather than swallowing it — in Sentry, not on the screen.
//
// **And only sentences we wrote reach the screen** (Alex, M3.1, the web photo walk: a
// failure printed "load failed (mxuajvlrkggrqpntekqt.supabase.co)"). The raw message
// and code used to ride along as `detail`; they now go to Sentry (`report`), and the
// screen gets our sentence for the cause, or one plain line (`@pind/shared`, said.ts).
import { isUnreachable, Said, SESSION_UNREACHABLE, sessionSays, sessionWayOut, WENT_WRONG } from "@pind/shared";
import { report } from "./sentry";
import { SessionProblem } from "./session";

export interface Described {
  says: string;
  // The exit the sentence promises (Alex, M3.1: a screen that says "go and sign in"
  // and has no button to do it is a dead end). `Trouble` renders it.
  wayOut?: "sign-in" | "retry";
}

// Postgres codes we can say something true and useful about, in words. The code itself
// never reaches the screen.
const CODES: Record<string, string> = {
  "42501": "Pin'd was not allowed to write that",
  "23505": "that already exists",
  "23503": "something it points at is missing",
  "23514": "that value was not accepted",
  "22001": "one of those is too long",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function describe(err: unknown, doing = "unnamed step"): Described {
  // Already classified — out, unreachable or unsure — by the shared rule.
  if (err instanceof SessionProblem) {
    if (err.read.state === "unsure") report(new Error(err.read.message), `${doing}: read the session`);
    return { says: sessionSays(err.read), wayOut: sessionWayOut(err.read) };
  }
  // The same rule the session read uses, so "could not be reached" means one thing.
  if (isUnreachable(err)) return { says: SESSION_UNREACHABLE, wayOut: "retry" };
  // A sentence written for a person (PhotoError is one) — the only text shown as is.
  if (err instanceof Said) return { says: err.message };

  report(err, doing);
  const code = isRecord(err) && typeof err.code === "string" ? err.code : undefined;
  return { says: code && CODES[code] ? CODES[code] : WENT_WRONG };
}

// "We could not save your date of birth and gender — Pin'd was not allowed to write
// that." A session, connection or `Said` sentence is already whole, and stands on its
// own rather than being folded into "We could not …".
export function failed(what: string, err: unknown): Described {
  if (err instanceof Said) return { says: err.message };
  const d = describe(err, what);
  if (d.wayOut) return d;
  return { says: `We could not ${what} — ${d.says}.` };
}

// One line, for a place that has room for only one.
export function oneLine(d: Described): string {
  return d.says;
}
