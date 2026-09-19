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
      detectSessionInUrl: false,
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
