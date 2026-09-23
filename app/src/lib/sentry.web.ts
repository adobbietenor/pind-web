// Crash reporting on the web — loaded AFTER the page is usable (Alex, M3.2).
//
// Sentry is about 1.9 MB of source in the web bundle (its replay module included,
// though replay is off), and it was parsed before anything painted — on A26, the page
// with a W2-sized budget. So on the web it is a separate chunk fetched once the page
// has loaded, and a report made before then waits in a short queue rather than being
// lost. The app on a phone keeps sentry.ts, unchanged: Metro picks this file for the
// web only.
//
// Same public surface as sentry.ts — initSentry, wrapRoot, report — so no caller
// knows which it got.
import type { ComponentType } from "react";
import Constants from "expo-constants";
import { afterFirstPaint } from "./later";
import { reportable } from "./reportable";

type SentryModule = typeof import("@sentry/react-native");

let sentry: SentryModule | undefined;
const waiting: { err: unknown; doing: string }[] = [];

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.info("Sentry disabled: EXPO_PUBLIC_SENTRY_DSN not set");
    return;
  }
  afterFirstPaint(async () => {
    const Sentry = await import("@sentry/react-native");
    const environment = String(Constants.expoConfig?.extra?.variant ?? "staging");
    Sentry.init({ dsn, environment, sendDefaultPii: false });
    sentry = Sentry;
    console.info("Sentry enabled (web, after first paint)");
    for (const w of waiting.splice(0)) report(w.err, w.doing);
  });
}

// On the web the root is not wrapped: Sentry.wrap's extras are touch breadcrumbs and a
// profiler, and wrapping would need the module before the first paint.
export function wrapRoot<P extends object>(root: ComponentType<P>): ComponentType<P> {
  return root;
}

export function report(err: unknown, doing: string): void {
  if (!sentry) {
    if (waiting.length < 20) waiting.push({ err, doing });
    if (__DEV__) console.warn(`[${doing}]`, err);
    return;
  }
  const { error, context } = reportable(err, doing);
  sentry.captureException(error, context);
}
