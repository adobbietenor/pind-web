import * as Sentry from "@sentry/react-native";
import { isRunningInExpoGo } from "expo";
import Constants from "expo-constants";

// Crash reporting (decisions Part 5, "Analytics and crashes"). Off unless the DSN
// is set, and off in Expo Go, which has no Sentry native module. Either way it
// says so once in the console, so a build that never reports is noticed.
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.info("Sentry disabled: EXPO_PUBLIC_SENTRY_DSN not set");
    return;
  }
  if (isRunningInExpoGo()) {
    console.info("Sentry disabled: native module unavailable");
    return;
  }
  const environment = String(Constants.expoConfig?.extra?.variant ?? "staging");
  Sentry.init({ dsn, environment, sendDefaultPii: false });
  console.info(`Sentry enabled (${environment})`);
}

export const wrapRoot = Sentry.wrap;
