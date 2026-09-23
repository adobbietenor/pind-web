import PostHog from "posthog-react-native";
import { Platform } from "react-native";

// Funnel events (decisions Part 5, "Analytics and crashes"). Off unless the
// project key is set, and it says so once in the console. No autocapture and
// no GeoIP: only the events we name, and nothing about where anyone is (H4).
let posthog: PostHog | undefined;

// On iOS PostHog persists to files through expo-file-system (part of expo itself).
// On the web it would keep nothing between visits, so give it localStorage.
const webStorage = {
  getItem: (key: string) => globalThis.localStorage?.getItem(key) ?? null,
  setItem: (key: string, value: string) => globalThis.localStorage?.setItem(key, value),
};

export function initAnalytics(): void {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key) {
    console.info("PostHog disabled: EXPO_PUBLIC_POSTHOG_KEY not set");
    return;
  }
  posthog = new PostHog(key, {
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    customStorage: Platform.OS === "web" ? webStorage : undefined,
    captureAppLifecycleEvents: false,
    // Send each event at once. The default batches for 10 seconds, and a tab
    // closed or backgrounded before then loses its events (seen in M2.0).
    flushAt: 1,
    disableGeoip: true,
  });
  console.info("PostHog enabled");
}

// The funnel events, named here so the set is a list rather than whatever a screen
// happened to type. M3.1 adds the store path's two steps.
export type AnalyticsEvent = "app_open" | "sign_in" | "profile_created";

// Properties are counts and flags only — never a name, an email, a photo path or a
// person id. PostHog runs with autocapture off, IP discarded and $geoip_disable on
// every event (decisions Part 5, "Analytics, as built"), and this is the other half
// of that promise: nothing identifying is put in deliberately either.
export function track(event: AnalyticsEvent, properties?: Record<string, string | number | boolean>): void {
  posthog?.capture(event, properties);
}
