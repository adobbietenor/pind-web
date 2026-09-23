// Signing in (A1), and the anonymous-to-permanent link (A27).
//
// **Anonymous at pin, permanent at opt-in, same user id** (decisions Part 5,
// "Identity"). Nothing here runs on launch: opening the app creates no auth user.
// The store path (A1) signs in first and makes the person row in A2; the link path
// pins anonymously (A26) and links the SAME user later, so the pin, the party size
// and the opt-in all survive — nothing is copied and nothing is re-keyed.
//
// Three methods, and no password field anywhere:
//   Apple   native in the app (Apple's rule: it must be offered beside Google); on
//           the web a redirect through the Services ID `social.pind.web`.
//   Google  everywhere. On the web it is a redirect; in the app it is an in-app
//           browser session that hands the tokens back through the app's scheme.
//   Email   a six-digit code, everywhere.

import * as AppleAuthentication from "expo-apple-authentication";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { signInMethods, type SignInMethod } from "@pind/shared";
import { supabase } from "./supabase";

export type Method = SignInMethod;

// The table lives in `@pind/shared`, where a test can load it (tests/unit/signin.test.ts).
export function methodsFor(platform: string = Platform.OS): Method[] {
  return signInMethods(platform);
}

// In the app, Apple hands us an identity token once. Supabase verifies it; we never
// see a password and never store the token.
//
// On the **web** it is a redirect, like Google's: Supabase sends the person to Apple
// with the Services ID, Apple posts back to Supabase's callback, and Supabase returns
// to `redirectTo` on our own origin with the session in the URL. This half uses the
// client secret minted from the `.p8` — the one that lapses on `APPLE_SECRET_EXPIRES`
// while native keeps working (decisions, "Sign in with Apple: the secret is a JWT").
export async function signInWithApple(redirectTo?: string): Promise<void> {
  if (Platform.OS === "web") {
    const { error } = await supabase().auth.signInWithOAuth({ provider: "apple", options: { redirectTo } });
    if (error) throw error;
    return;
  }

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

// **Two shapes, one provider** (Alex, M3.1, agreeing the two modules: Google is the
// most common sign-in on Android and on the web, and dropping it in the app would
// make the platforms diverge for no good reason).
//
// On the **web** it is an ordinary redirect back to our own origin — pind.social, the
// same host the Worker serves, so nothing leaves it.
//
// In the **app** Supabase cannot redirect to a page, so the flow is: open Google in an
// in-app browser session, let it come back to the app's own scheme with a code, and
// exchange that code for a session. `skipBrowserRedirect` is what stops supabase-js
// trying to navigate a window that does not exist.
export async function signInWithGoogle(redirectTo?: string): Promise<void> {
  const auth = supabase().auth;
  if (Platform.OS === "web") {
    const { error } = await auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) throw error;
    return;
  }

  const returnTo = AuthSession.makeRedirectUri();
  const { data, error } = await auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: returnTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Google did not give us a sign-in page");

  const result = await WebBrowser.openAuthSessionAsync(data.url, returnTo);
  // Dismissed or cancelled is not an error: signInError() turns it into no message
  // at all, so closing the sheet leaves no red text behind.
  if (result.type !== "success") throw new Error("ERR_REQUEST_CANCELED");

  const code = new URL(result.url).searchParams.get("code");
  if (!code) throw new Error("Google came back without a code");
  const exchange = await auth.exchangeCodeForSession(code);
  if (exchange.error) throw exchange.error;
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
