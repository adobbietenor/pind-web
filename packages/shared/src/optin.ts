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

// ---------------------------------------------------------------------------
// What still stands between a person and "open to meeting" — the SAME three facts the
// database's gate checks (`private.may_meet`: a permanent account, a people_private row,
// a photo), read the way A27 reads them. A27 picks its step from this, and says it when
// the gate refuses (Alex, M3.2 walk: "a refusal here has to say what's missing and offer
// the way to fix it"). P126 compares it with `i_may_meet()` on real rows for every
// combination, so the screen and the gate cannot disagree about what "complete" means.
// ---------------------------------------------------------------------------

export interface OptInFacts {
  permanent: boolean;
  hasPrivate: boolean;
  hasPhoto: boolean;
}

export type OptInNeed = "details" | "photo" | "sign-in";

const NEED_WORDS: Record<OptInNeed, string> = {
  details: "your date of birth and gender",
  photo: "a photo of you",
  "sign-in": "a way to sign in",
};

export function optInMissing(f: OptInFacts): {
  missing: OptInNeed[];
  step: "details" | "contact" | "safety";
  says: string | null;
} {
  const missing: OptInNeed[] = [];
  if (!f.hasPrivate) missing.push("details");
  if (!f.hasPhoto) missing.push("photo");
  if (!f.permanent) missing.push("sign-in");
  const step = !f.hasPrivate || !f.hasPhoto ? "details" : !f.permanent ? "contact" : "safety";
  if (missing.length === 0) return { missing, step, says: null };
  const words = missing.map((m) => NEED_WORDS[m]);
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  const fix =
    missing.length > 1 ? "Start below — it takes a minute." : step === "details" ? "Add it below, then you're in." : "Set it up below, then you're in.";
  return {
    missing,
    step,
    says: `${missing.length === 1 ? "One thing" : "A few things"} before you can meet people here: ${list}. ${fix}`,
  };
}
