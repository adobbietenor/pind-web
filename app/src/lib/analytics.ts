import type PostHog from "posthog-react-native";
import { Platform } from "react-native";
import { afterFirstPaint } from "./later";

// Funnel events (decisions Part 5, "Analytics and crashes"). Off unless the
// project key is set, and it says so once in the console. No autocapture and
// no GeoIP: only the events we name, and nothing about where anyone is (H4).
//
// **Loaded after first paint on the web** (Alex, M3.2): PostHog is about 0.75 MB of
// source, and A26 has a W2-sized budget. It is a separate chunk fetched once the page
// is usable; an event tracked before then is queued, not lost. On a phone it starts at
// once, as before.
let posthog: PostHog | undefined;
const queued: { event: AnalyticsEvent; properties?: Record<string, string | number | boolean> }[] = [];

// On iOS PostHog persists to files through expo-file-system (part of expo itself).
// On the web it would keep nothing between visits, so give it localStorage.
const webStorage = {
  getItem: (key: string) => globalThis.localStorage?.getItem(key) ?? null,
  setItem: (key: string, value: string) => globalThis.localStorage?.setItem(key, value),
};

// **On the web, our own origin** (M3.2): the Worker forwards /ingest to PostHog, so a
// public page like A26 talks to nobody but pind.social (the own-origin rule). The app
// on a phone is not a page anyone pastes into Reddit and keeps the direct host.
function analyticsHost(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return `${window.location.origin}/ingest`;
  return process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
}

export function initAnalytics(): void {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key) {
    console.info("PostHog disabled: EXPO_PUBLIC_POSTHOG_KEY not set");
    return;
  }
  afterFirstPaint(async () => {
    const { default: PostHogClient } = await import("posthog-react-native");
    posthog = new PostHogClient(key, {
      host: analyticsHost(),
      customStorage: Platform.OS === "web" ? webStorage : undefined,
      captureAppLifecycleEvents: false,
      // Send each event at once. The default batches for 10 seconds, and a tab
      // closed or backgrounded before then loses its events (seen in M2.0).
      flushAt: 1,
      disableGeoip: true,
    });
    console.info("PostHog enabled");
    for (const q of queued.splice(0)) posthog.capture(q.event, q.properties);
  });
}

// The funnel events, named here so the set is a list rather than whatever a screen
// happened to type. M3.1 adds the store path's two steps.
export type AnalyticsEvent = "app_open" | "sign_in" | "profile_created";

// Properties are counts and flags only — never a name, an email, a photo path or a
// person id. PostHog runs with autocapture off, IP discarded and $geoip_disable on
// every event (decisions Part 5, "Analytics, as built"), and this is the other half
// of that promise: nothing identifying is put in deliberately either.
export function track(event: AnalyticsEvent, properties?: Record<string, string | number | boolean>): void {
  if (posthog) posthog.capture(event, properties);
  else if (queued.length < 50) queued.push({ event, properties });
}
