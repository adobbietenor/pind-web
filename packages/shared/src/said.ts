// What a person may read about a failure (M3.1, from the web photo walk).
//
// **Only sentences we wrote.** The failed-upload sentence read "load failed
// (mxuajvlrkggrqpntekqt.supabase.co)": the browser's own error text, passed straight
// through, printing an internal hostname — the same string that already makes the
// Google sign-in sheet look like a scam. Nothing about that string helps the person,
// and the same road could print a table name or a Postgres code. So:
//
//   * a sentence written for a person is thrown as `Said` (or a subclass), and is the
//     only error text a screen ever shows as it is;
//   * a failure we can name — no network, a refused write — gets a fixed sentence;
//   * anything else gets one plain line, and the raw error goes to Sentry, where the
//     technical detail belongs (Alex).
//
// `looksTechnical` is the check the tests put every person-facing sentence through
// (L01–L08), with the real raw strings in front of it.

import { isUnreachable } from "./session.ts";

export class Said extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Said";
  }
}

export const WENT_WRONG = "something went wrong on our side";

// Why an upload failed, in words — never the error's own text. "Pin'd could not be
// reached" rather than "load failed": the same cause reads the same on every platform
// (Safari says "Load failed", the app "Network request failed").
export const UPLOAD_UNREACHABLE = "Pin'd could not be reached";
export const UPLOAD_TOO_BIG = "the photo is too big";
export const UPLOAD_OTHER = "the upload did not go through";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function uploadReason(err: unknown): string {
  if (isUnreachable(err)) return UPLOAD_UNREACHABLE;
  if (isRecord(err)) {
    const status = Number(err.status ?? err.statusCode);
    const message = typeof err.message === "string" ? err.message : "";
    if (status === 413 || /too large|exceeded the maximum/i.test(message)) return UPLOAD_TOO_BIG;
  }
  return UPLOAD_OTHER;
}

// What must never reach a screen: a URL or hostname, a Postgres or PostgREST code, a
// schema-qualified or snake_case identifier (every table and column name has an
// underscore or is one of the bare table names below), a JWT, an HTTP status line.
const TABLES = ["people", "pins", "crews", "blocks", "reports", "photos", "gatherings", "venues"];
// Our own public domain is meant for people — privacy@pind.social, safety@pind.social,
// pind.social itself — so it is taken out first; every other host still counts
// (a lookalike such as notpind.social included: the boundary is checked, L01/L02).
const OUR_DOMAIN = /(?<![a-z0-9-])(?:[a-z0-9.+-]+@)?(?:www\.)?pind\.social\b/gi;

export function looksTechnical(raw: string): boolean {
  const text = raw.replace(OUR_DOMAIN, "");
  if (/https?:\/\//i.test(text)) return true;
  if (/\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(co|com|social|io|net|org|dev|app|workers\.dev)\b/i.test(text)) return true;
  // SQLSTATE: two digits, a digit or letter, two digits (42501, 22P02, 42P01).
  if (/\bPGRST\d+\b|\b\d{2}[0-9A-Z]\d{2}\b/.test(text)) return true;
  if (/\b[a-z]+_[a-z_]+\b/.test(text)) return true;
  if (/\b(relation|column|constraint|violates|row-level security|schema|jwt|bearer)\b/i.test(text)) return true;
  if (new RegExp(`"(${TABLES.join("|")})"|\\b(public|auth|storage)\\.[a-z]`, "i").test(text)) return true;
  if (/\beyJ[A-Za-z0-9_-]{10,}/.test(text)) return true;
  if (/\bHTTP \d{3}\b|\b[45]\d{2} [A-Z]/.test(text)) return true;
  return false;
}
