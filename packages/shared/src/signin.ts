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
