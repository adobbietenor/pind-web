import * as Sentry from "@sentry/react-native";
import { isRunningInExpoGo } from "expo";
import Constants from "expo-constants";
import { reportable } from "./reportable";

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

// **Where a failure's technical detail goes** (Alex, M3.1): the person reads a
// sentence we wrote, and the raw error — hostname, code, table and all — comes here.
// On the web this file is replaced by sentry.web.ts, which loads Sentry after first
// paint (M3.2); the wrapping is shared in reportable.ts.
export function report(err: unknown, doing: string): void {
  const { error, context } = reportable(err, doing);
  Sentry.captureException(error, context);
  if (__DEV__) console.warn(`[${doing}]`, err);
}
