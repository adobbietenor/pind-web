// A27 — Opt in: the words, in one place (M3.2).
//
// Only for someone who ticked "meet up" at A26, or turns it on later. The spec's order
// (A27): date of birth — under 19 stops here, no soft fail (H8), only the year kept;
// gender, never shown to others; a photo (Q2); a way to reach you — the email code,
// Apple or Google; then ONE safety sheet, where the privacy policy and terms are
// accepted. The anonymous user becomes permanent with the same id; the pin, the party
// size and the intent survive, and the pin opens only now (the opt-in gate, P105–P109).

export const OPTIN_COPY = {
  heading: "A few details",
  lede: "So the people going can find you. Your date of birth and gender are never shown to anyone.",
  // Under 19 at A27 removes the person completely (Alex, M3.2; P103). The screen says
  // so plainly: they told us, and their pin is gone.
  under19Removed: "Pin'd is 19+. Your pin has been removed, and nothing about you is kept.",
  // The way to sign in, so the same account comes back on another phone.
  contactHeading: "A way to sign in",
  contactWhy: "So you can come back to this on any phone. No password — we send you a code.",
  email: "Your email",
  sendCode: "Email me a code",
  code: "The six-digit code",
  codeSent: "We've sent a code to that address. It can take a minute.",
  verify: "Confirm",
  // The address already has an account: the merge (decisions, M3.2). Until it is
  // proved, nothing moves, and the screen says the pin is safe (Alex).
  emailHasAccount:
    "That email already has a Pin'd account. We've sent a code to it — enter it to bring this pin into that account.",
  nothingLost: "Nothing was lost — your pin is still there. Try again in a moment.",
  // Until the merge is built (next in M3.2): the honest sentence for that branch.
  emailHasAccountForNow:
    "That email already has a Pin'd account. Joining this pin to it is nearly ready — for now, use another address. Nothing was lost; your pin is still there.",
  // The link path's one safety sheet (spec A27), verbatim.
  safetyHeading: "Before you meet anyone",
  safety: [
    "Crews are 3–8 people at a public spot before the event.",
    "Leave any time.",
    "Block and report are two taps away.",
    "Women-only crews on every gathering.",
  ],
  accept: "I've read the privacy policy and terms",
  finish: "I'm in — show me who's going",
} as const;

// "That address already has an account" — the branch that becomes the merge. Read from
// the auth server's code first and its message second (supabase-js has returned both
// shapes); anything else is not this branch, and must not be mistaken for it.
export function isEmailTaken(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === "email_exists") return true;
  return typeof e.message === "string" && /already (been )?registered|email address .*already/i.test(e.message);
}
