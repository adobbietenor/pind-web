import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import type { Database } from "@pind/shared";
import { secureStorage } from "./secure-storage";

// The app's only Supabase client. It holds the anon (publishable) key and nothing
// else: every read is made as the signed-in person, so RLS decides what they see
// (H11). The service_role key never appears in the app.
let client: SupabaseClient<Database> | undefined;

export function supabase(): SupabaseClient<Database> {
  if (client) return client;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set");
  if (!key.startsWith("sb_publishable_")) throw new Error("EXPO_PUBLIC_SUPABASE_ANON_KEY must be the publishable key");
  client = createClient<Database>(url, key, {
    auth: {
      // The web build keeps the session in localStorage (the default); iOS in the Keychain.
      storage: Platform.OS === "web" ? undefined : secureStorage,
      persistSession: true,
      autoRefreshToken: true,
      // **On the web this must be true, and it was false until M3.1.** An OAuth
      // sign-in hands the session back IN THE RETURN URL — Google goes to Supabase,
      // Supabase redirects to pind.social/you carrying the code — and with this off
      // the client ignored it, so a person came back from Google with no session and
      // the next screen told them it had expired. It had never existed.
      //
      // It was set false in M2.0, correctly: nothing redirected back then. It became
      // wrong the moment there was an OAuth flow, and nothing connected the two.
      //
      // In the native app it stays off, because there is no page to come back to:
      // `signInWithGoogle` opens a browser session and exchanges the code itself.
      detectSessionInUrl: Platform.OS === "web",
      // Stated rather than inherited. The native path calls exchangeCodeForSession,
      // which only works under PKCE, and a default that changes underneath us would
      // break it silently.
      flowType: "pkce",
    },
  });
  if (Platform.OS !== "web") {
    // Refresh the token only while the app is in the foreground.
    AppState.addEventListener("change", (state) => {
      if (state === "active") client?.auth.startAutoRefresh();
      else client?.auth.stopAutoRefresh();
    });
  }
  return client;
}

// Anonymous at pin, permanent at opt-in, same user id (decisions Part 5, "Identity").
// Call this only when the person pins in (A26) — never on launch, so opening the
// app creates no auth user. Returns the existing session's user if there is one.
export async function ensureAnonymousUser(): Promise<string> {
  const auth = supabase().auth;
  const { data: existing } = await auth.getSession();
  if (existing.session) return existing.session.user.id;
  const { data, error } = await auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error("Anonymous sign-in returned no user");
  return data.user.id;
}
