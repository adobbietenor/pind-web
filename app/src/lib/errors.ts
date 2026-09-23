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
// rather than swallowing it — during a walk that detail is the whole diagnosis.

import { isUnreachable, SESSION_UNREACHABLE, sessionSays, sessionWayOut } from "@pind/shared";
import { SessionProblem } from "./session";

export interface Described {
  says: string;
  detail?: string;
  // The exit the sentence promises (Alex, M3.1: a screen that says "go and sign in"
  // and has no button to do it is a dead end). `Trouble` renders it.
  wayOut?: "sign-in" | "retry";
}

// Postgres codes we can say something true and useful about. Anything else keeps its
// own message, which is better than a guess.
const CODES: Record<string, string> = {
  "42501": "Pin'd was not allowed to write that",
  "23505": "that already exists",
  "23503": "something it points at is missing",
  "23514": "the database refused the value as invalid",
  "22001": "one of those is too long",
  PGRST116: "nothing came back when exactly one row was expected",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function describe(err: unknown): Described {
  if (typeof err === "string") return { says: err };
  // Already classified — out, unreachable or unsure — by the shared rule.
  if (err instanceof SessionProblem) return { says: sessionSays(err.read), wayOut: sessionWayOut(err.read) };
  // The same rule the session read uses, so "could not be reached" means one thing.
  if (isUnreachable(err)) return { says: SESSION_UNREACHABLE, wayOut: "retry" };

  if (isRecord(err)) {
    const message = typeof err.message === "string" ? err.message : "";
    const code = typeof err.code === "string" ? err.code : undefined;

    if (code && CODES[code]) {
      return { says: CODES[code], detail: `${message}${code ? ` (${code})` : ""}` };
    }
    if (message) return { says: message, detail: code ? `(${code})` : undefined };
  }
  return { says: "something went wrong" };
}

// "We could not save your date of birth and gender — Pin'd was not allowed to write
// that." plus the raw detail underneath. A session or connection sentence is already
// whole, and stands on its own rather than being folded into "We could not …".
export function failed(what: string, err: unknown): Described {
  const d = describe(err);
  if (d.wayOut) return d;
  return { says: `We could not ${what} — ${d.says}.`, detail: d.detail };
}

// One line, for a place that has room for only one.
export function oneLine(d: Described): string {
  return d.detail ? `${d.says} ${d.detail}` : d.says;
}
