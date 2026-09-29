import type { ExpoConfig } from "expo/config";

// One codebase, two variants. APP_VARIANT is set per EAS profile (eas.json);
// local runs default to staging. Staging and production install side by side.
const variant = process.env.APP_VARIANT === "production" ? "production" : "staging";
const isProduction = variant === "production";

// Bundle identifiers are permanent once registered with Apple.
const bundleIdentifier = isProduction ? "social.pind.app" : "social.pind.app.staging";

const config: ExpoConfig = {
  name: isProduction ? "Pin'd" : "Pin'd Staging",
  slug: "pind",
  owner: "alexdobbie",
  scheme: isProduction ? "pind" : "pind-staging",
  version: "1.0.0",
  orientation: "portrait",
  // brand/icon-1024.png — the safety pin, white on #582883, RGB with no alpha (Apple
  // refuses an icon with transparency). Replaced M2.0's flat purple placeholder in M3.3.
  icon: "./assets/icon.png",
  // Dark always, whatever the phone is set to (decisions Part 5, "Dark only").
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier,
    appleTeamId: "93M6B4W5PR",
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  web: {
    output: "single",
    bundler: "metro",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    // Google sign-in in the native app (Alex, M3.1). Supabase's OAuth flow needs an
    // in-app browser session; this plugin is what closes it and hands the redirect
    // back to the app through the `scheme` above.
    "expo-web-browser",
    // Push (M3.3): the entitlement and the permission prompt. The prompt is never shown
    // at launch — only after the room's own "Turn on" card (app/src/lib/push.ts).
    "expo-notifications",
    // Org and project slugs are not secret. The auth token for source-map upload is
    // SENTRY_AUTH_TOKEN, an EAS secret, never in the repo.
    ["@sentry/react-native/expo", { organization: "pind-9y", project: "pind-app" }],
    [
      "expo-splash-screen",
      {
        // Solid near-black (tokens.ts colors.dark.background), no animation, with the
        // white logo from brand/splash-logo.png (M3.3; the slot sat empty from M2.0).
        backgroundColor: "#0B0A0D",
        image: "./assets/splash-logo.png",
        imageWidth: 200,
        resizeMode: "contain",
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    variant,
    // The EAS project @alexdobbie/pind (from `eas init`); an id, not a secret.
    eas: { projectId: "5cf6b37d-3386-4bd1-b296-5bad7541bfed" },
  },
};

export default config;
