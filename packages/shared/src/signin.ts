// Which sign-in methods A1 offers, per platform (M3.1).
//
// **Here rather than in `app/src/lib/auth.ts`** for the same reason the tag caps moved:
// auth.ts imports React Native, so `node --test` could not load it, and nothing proved
// what this table said. It said Apple was native-only — the decision "Sign in with
// Apple on the web: later" — and it kept saying so after the Services ID, the minted
// secret and the expiry watch were built for the web. The whole web Apple path was
// wired and unreachable, and nothing that could run noticed (Alex, M3.1).
//
//   ios      Apple, Google, the email code. Apple is required beside Google (Apple's rule).
//   web      the same three (Alex, M3.1: A1 is three methods, on the web too).
//   android  Google and the email code. Android follows iOS (decisions Part 5); there
//            is no native Apple button there, and listing one would be a row that
//            renders nothing.
export type SignInMethod = "apple" | "google" | "email";

export function signInMethods(platform: string): SignInMethod[] {
  return platform === "android" ? ["google", "email"] : ["apple", "google", "email"];
}

// ---------------------------------------------------------------------------
// What a failed sign-in says (M3.1, from the walk).
//
// **"That code has expired" appeared when no code was in play.** The old rule turned
// any message containing "invalid" into it — so a stale session ("Invalid Refresh
// Token: Refresh Token Not Found") or a mistyped address read as an expired code. An
// instrument answering confidently and wrongly (CLAUDE.md). Now the sentence depends
// on the STEP that failed, and only entering a code can say a code expired.
// ---------------------------------------------------------------------------
export type SignInStep = "send" | "verify" | "oauth";

export const SIGNIN_CODE_BAD = "That code has expired or isn't right. Ask for a new one.";
export const SIGNIN_STALE = "Your last sign-in had lapsed on this device. Try again — it should work now.";
export const SIGNIN_BAD_EMAIL = "That email address doesn't look right.";
export const SIGNIN_TOO_MANY = "Too many tries. Give it a minute.";
export const SIGNIN_NOT_ON = "That way in is not switched on yet. Try the email code.";

// A leftover session this device can no longer refresh. The screen clears it locally
// so the next attempt starts clean.
export function isStaleSession(message: string): boolean {
  return /refresh token/i.test(message);
}

export function signInSays(step: SignInStep, message: string): string {
  if (/canceled|cancelled|ERR_REQUEST_CANCELED/i.test(message)) return "";
  if (isStaleSession(message)) return SIGNIN_STALE;
  if (/rate limit|too many/i.test(message)) return SIGNIN_TOO_MANY;
  if (/provider is not enabled/i.test(message)) return SIGNIN_NOT_ON;
  if (step === "verify" && /expired|invalid/i.test(message)) return SIGNIN_CODE_BAD;
  if (step === "send" && /email/i.test(message) && /invalid/i.test(message)) return SIGNIN_BAD_EMAIL;
  return message || "That did not work. Try again.";
}
