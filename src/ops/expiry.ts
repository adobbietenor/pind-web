// Credentials that lapse on a date (Phase 3 M3.1).
//
// **The failure this exists for.** Apple caps the client secret for Sign in with
// Apple at six months. When it lapses, **web** Apple sign-in stops working and
// **native iOS keeps working**, because the native flow verifies an identity token
// and never uses this secret. So the break is partial, silent, and on the half
// nobody is looking at — which makes it easier to miss, not harder (Alex, M3.1).
//
// Nothing can detect this by asking: the secret lives in Supabase's provider settings
// and never reaches the Worker, and Apple only rejects it at the token exchange, in
// the middle of somebody's sign-in. So the expiry is **recorded** when the secret is
// minted (`scripts/apple-client-secret.ts` prints the line) and watched from here.
//
// **Unset is a different state from broken**, as everywhere else: a date that was
// never recorded is not "fine", it is "nobody knows", and it says so.
//
// No imports, so the unit tests load it under bare node.

export type ExpiryState = "ok" | "soon" | "lapsed" | "unrecorded" | "unreadable";

export interface Expiry {
  name: string;
  what: string;
  state: ExpiryState;
  day: string | null;
  daysLeft: number | null;
  says: string;
}

// Six weeks. Long enough that a busy fortnight cannot swallow it, short enough that
// it is not background noise for five months.
export const WARN_DAYS = 42;

export function daysUntil(day: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const then = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  return Math.floor((then - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
}

export function appleSecretExpiry(value: string | undefined, now = new Date()): Expiry {
  const name = "APPLE_SECRET_EXPIRES";
  const what = "Sign in with Apple on the web. Native iOS is unaffected, which is what makes this easy to miss.";
  const day = value?.trim() || null;
  if (!day) {
    return {
      name,
      what,
      state: "unrecorded",
      day: null,
      daysLeft: null,
      says:
        "Not recorded, so nobody knows when it lapses. Mint the secret with scripts/apple-client-secret.ts and put the date it prints in wrangler.jsonc.",
    };
  }
  const daysLeft = daysUntil(day, now);
  if (daysLeft === null) {
    return { name, what, state: "unreadable", day, daysLeft: null, says: `"${day}" is not a date in YYYY-MM-DD form.` };
  }
  if (daysLeft < 0) {
    return {
      name,
      what,
      state: "lapsed",
      day,
      daysLeft,
      says: `Lapsed ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago. Apple sign-in on the web is refused; the app is still fine, so nobody may have said anything.`,
    };
  }
  if (daysLeft <= WARN_DAYS) {
    return {
      name,
      what,
      state: "soon",
      day,
      daysLeft,
      says: `Lapses in ${daysLeft} day${daysLeft === 1 ? "" : "s"}, on ${day}. Mint a new one before then — it takes a minute and the .p8 you already have.`,
    };
  }
  return { name, what, state: "ok", day, daysLeft, says: `Good until ${day} (${daysLeft} days).` };
}

// Everything on a date, in one list, so a second one is a row rather than a rewrite.
export function expiringCredentials(env: { APPLE_SECRET_EXPIRES?: string }, now = new Date()): Expiry[] {
  return [appleSecretExpiry(env.APPLE_SECRET_EXPIRES, now)];
}

// What deserves reaching out rather than waiting to be looked at. An unrecorded date
// is included: it is the state where the warning itself does not exist.
export function worthAnAlert(expiries: Expiry[]): Expiry[] {
  return expiries.filter((e) => e.state === "soon" || e.state === "lapsed" || e.state === "unrecorded" || e.state === "unreadable");
}
