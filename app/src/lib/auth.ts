// Signing in (A1), and the anonymous-to-permanent link (A27).
//
// **Anonymous at pin, permanent at opt-in, same user id** (decisions Part 5,
// "Identity"). Nothing here runs on launch: opening the app creates no auth user.
// The store path (A1) signs in first and makes the person row in A2; the link path
// pins anonymously (A26) and links the SAME user later, so the pin, the party size
// and the opt-in all survive — nothing is copied and nothing is re-keyed.
//
// Three methods, and no password field anywhere:
//   Apple   native in the app (Apple's rule: it must be offered beside Google).
//           On the web it comes later (decisions Part 5).
//   Google  on the web today. In the app it needs a browser session, which is a
//           native module we have not agreed — see GOOGLE_IN_APP below.
//   Email   a six-digit code, everywhere, with no new dependency.

import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { supabase } from "./supabase";

export type Method = "apple" | "google" | "email";

// **Google in the native app is not wired up, deliberately.** Supabase's OAuth flow
// needs an in-app browser session, which means expo-web-browser / expo-auth-session —
// native modules outside the agreed M2.0 list (apple-authentication, image-picker,
// image, notifications, secure-store), and CLAUDE.md says a dependency is Alex's call
// rather than something a milestone helps itself to. Until he says yes the app offers
// Apple and the email code, and the web offers Google and the email code, which is
// what the M3.1 acceptance list asks for on each platform anyway.
export const GOOGLE_IN_APP = false;

export function methodsFor(platform = Platform.OS): Method[] {
  if (platform === "web") return ["google", "email"];
  return GOOGLE_IN_APP ? ["apple", "google", "email"] : ["apple", "email"];
}

// Apple hands us an identity token once. Supabase verifies it; we never see a
// password and never store the token.
export async function signInWithApple(): Promise<void> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
  });
  if (!credential.identityToken) throw new Error("Apple did not return an identity token");
  const { error } = await supabase().auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
  });
  if (error) throw error;
}

// Web only for now. The redirect returns to the app's own origin, which is
// pind.social — the same host the Worker serves, so nothing leaves our origin.
export async function signInWithGoogle(redirectTo?: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
}

// A six-digit code, not a magic link (decisions Part 5, "Identity": no magic links).
// `shouldCreateUser` is on: this is a sign-in and a sign-up in one door, which is
// what "no password path" means.
export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const { error } = await supabase().auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: "email",
  });
  if (error) throw error;
}

// **The link, A27.** The same auth user gains an email identity; `auth_user_id` does
// not change, so the person row, the pin, the party size and the opt-in survive.
// This is the step build-plan §3 names as most likely to slip on iOS Safari.
export async function linkEmail(email: string): Promise<void> {
  const { error } = await supabase().auth.updateUser({ email: email.trim().toLowerCase() });
  if (error) throw error;
}

// Whether this session is a real identity or still the anonymous one made at a pin.
export async function isPermanent(): Promise<boolean> {
  const { data } = await supabase().auth.getUser();
  return !!data.user && !data.user.is_anonymous;
}

// A friendly sentence for a failure the person can act on, and the raw message for
// one they cannot. Supabase's own strings are terse and sometimes blame the reader.
export function signInError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/token has expired|invalid|expired/i.test(message)) return "That code has expired. Ask for a new one.";
  if (/rate limit|too many/i.test(message)) return "Too many tries. Give it a minute.";
  if (/canceled|cancelled|ERR_REQUEST_CANCELED/i.test(message)) return "";
  if (/provider is not enabled/i.test(message)) return "That way in is not switched on yet. Try the email code.";
  return message || "That did not work. Try again.";
}
