// Run something once the page is usable — the web's "after first paint" (M3.2).
//
// Analytics and crash reporting are not what a person came for, so on the web they
// wait for the page's load event and then an idle moment, and never compete with the
// first screen for the network or the main thread. On a phone there is no page to
// wait for, so they run at once.
import { Platform } from "react-native";

export function afterFirstPaint(run: () => void | Promise<void>): void {
  const go = () => {
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    const start = () => void Promise.resolve(run()).catch((err) => console.warn("deferred start failed", err));
    if (idle) idle(start, { timeout: 3000 });
    else setTimeout(start, 200);
  };
  if (Platform.OS !== "web" || typeof window === "undefined") {
    void Promise.resolve(run()).catch((err) => console.warn("start failed", err));
    return;
  }
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}
