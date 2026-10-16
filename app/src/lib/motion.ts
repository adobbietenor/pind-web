// Motion and touch, decided once (the "feel alive" pass, 16 Oct 2026).
//
// **Quick and springy, never slow.** Nothing runs longer than MOTION_MAX_MS (250 ms):
// motion is there to make the app feel faster, not to make anyone wait for it. React
// Native's own Animated, no Reanimated — the bundle already takes ~15 s to open on the
// mobile profile, and this adds nothing to it.
//
// **Reduce Motion is respected everywhere** (iOS Settings → Accessibility → Motion, or
// the browser's prefers-reduced-motion): scales, rises and fades go instant. Haptics stay —
// they are not motion, and they are how a tap is confirmed without looking.
//
// **Haptics are the app's, not the web's.** On the web expo-haptics would vibrate an
// Android phone, or work around iOS Safari, from a page that never asked to — so a
// haptic is a no-op there. Three kinds, and nothing on passive taps or scrolling:
//   * "action" — a light tap on the primary acts: pin, send, join, propose, accept;
//   * "select" — the selection tick on chips and toggles;
//   * "success" — pinning, the core act of the product, once it has landed.
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Easing, Platform } from "react-native";

export const MOTION_MAX_MS = 250;
// A press: how far down, and how it springs back.
export const PRESS_SCALE = 0.97;
export const PRESS_SPRING = { speed: 40, bounciness: 6 } as const;
// Lists and cards: how far they rise, how long, and the stagger between neighbours.
// The last of a staggered list lands by RISE_MS + STAGGER_MS × STAGGER_MAX = 260 ms.
export const RISE_PX = 8;
export const RISE_MS = 160;
export const STAGGER_MS = 25;
// Past this many, the rest arrive with the last: a long list never waits on its own entrance.
export const STAGGER_MAX = 4;
export const EASE_OUT = Easing.out(Easing.cubic);
// Animated's native driver on the phone; on the web there is none.
export const NATIVE_DRIVER = Platform.OS !== "web";

export type HapticKind = "action" | "select" | "success";

export function haptic(kind: HapticKind): void {
  if (Platform.OS === "web") return;
  // A haptic that fails is a tap that still works: never let one throw into a press.
  const done = (p: Promise<void>) => void p.catch(() => undefined);
  try {
    if (kind === "select") done(Haptics.selectionAsync());
    else if (kind === "success") done(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    else done(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  } catch {
    // No haptic engine (a simulator, an old device): nothing to feel, nothing broken.
  }
}

// The person's Reduce Motion setting, read once and kept current. Starts false: the first
// frame may move, which is the lesser fault than never moving for anyone.
let reduced = false;
let read = false;
const listeners = new Set<(on: boolean) => void>();
function start() {
  if (read) return;
  read = true;
  void AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => {
      reduced = on;
      listeners.forEach((l) => l(on));
    })
    .catch(() => undefined);
  AccessibilityInfo.addEventListener?.("reduceMotionChanged", (on: boolean) => {
    reduced = on;
    listeners.forEach((l) => l(on));
  });
}

export function useReduceMotion(): boolean {
  const [on, setOn] = useState(reduced);
  useEffect(() => {
    start();
    setOn(reduced);
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return on;
}

// For code outside a component (the tab bar's options).
export const reduceMotionNow = () => reduced;
