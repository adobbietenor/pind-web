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

// **Where a failure's technical detail goes** (Alex, M3.1): the person reads a
// sentence we wrote, and the raw error — hostname, code, table and all — comes here.
// A PostgREST or Storage error is a plain object, not an Error, so it is wrapped to
// keep its message and code rather than arriving as "Non-Error exception".
export function report(err: unknown, doing: string): void {
  const record = typeof err === "object" && err !== null ? (err as Record<string, unknown>) : {};
  const error =
    err instanceof Error ? err : new Error(typeof record.message === "string" ? record.message : String(err));
  Sentry.captureException(error, { tags: { doing }, extra: { code: record.code, status: record.status ?? record.statusCode } });
  if (__DEV__) console.warn(`[${doing}]`, err);
}
