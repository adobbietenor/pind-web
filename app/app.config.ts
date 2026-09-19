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
    // Org and project slugs are not secret. The auth token for source-map upload is
    // SENTRY_AUTH_TOKEN, an EAS secret, never in the repo.
    ["@sentry/react-native/expo", { organization: "pind-9y", project: "pind-app" }],
    [
      "expo-splash-screen",
      {
        // Solid near-black (tokens.ts colors.dark.background), no animation. The
        // logo slot is empty until Alex supplies the file: add `image` and
        // `imageWidth` here then.
        backgroundColor: "#0B0A0D",
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
