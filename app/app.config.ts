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
  scheme: isProduction ? "pind" : "pind-staging",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  // Dark by default; light follows the system setting (spec §3, A25).
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier,
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
    "@sentry/react-native/expo",
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
    // Filled by `eas init` (Alex runs it); the EAS project id, not a secret.
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
