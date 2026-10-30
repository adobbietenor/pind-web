// The keyboard, measured once for every frame (UI pass 1, round 2: "wherever you type, the
// screen makes room for the keyboard").
//
// **Why not KeyboardAvoidingView.** It works out the keyboard's overlap from its own frame,
// measured relative to its parent, so anything above it (a safe area, a header) skews the
// sum, and each screen that used one had to get that right on its own. The squad form sat
// in a Modal with nothing at all, and its fields were covered on the phone. So one hook
// measures how much of the window the keyboard covers, from the keyboard's own frame (iOS)
// or the visual viewport (the web, where a phone's keyboard shrinks it), and the two frames
// that hold every field, AppScreen and SheetFrame, make exactly that much room.
//
// `useKeepInView` then keeps the focused field, and room for the button under it, above
// the keyboard: when the keyboard comes up, when it changes height, and when focus moves to
// another field (iOS sends the keyboard's show again for each; the web has focusin).
// tests/unit/screens.test.ts (S52-S55) fails if a screen measures the keyboard itself.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Dimensions, Keyboard, Platform, TextInput, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";

// Room kept under a focused field for what comes next: the hint, a refusal, the button.
const ROOM_BELOW = 112;
// And never closer than this to the top of what is visible.
const ROOM_ABOVE = 16;

type VV = { height: number; offsetTop: number; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void };
const visualViewport = (): VV | null => (Platform.OS === "web" ? ((globalThis as { visualViewport?: VV }).visualViewport ?? null) : null);

// How many points at the foot of the window the keyboard covers now; 0 when it is down.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") {
      const vv = visualViewport();
      if (!vv) return;
      const fit = () => {
        const inner = (globalThis as { innerHeight?: number }).innerHeight ?? vv.height;
        setInset(Math.max(0, Math.round(inner - vv.height)));
        // Safari pans the page to show the focused field; the frame already fits, so undo it.
        if (vv.offsetTop > 0) (globalThis as { scrollTo?: (x: number, y: number) => void }).scrollTo?.(0, 0);
      };
      fit();
      vv.addEventListener("resize", fit);
      vv.addEventListener("scroll", fit);
      return () => {
        vv.removeEventListener("resize", fit);
        vv.removeEventListener("scroll", fit);
      };
    }
    // iOS tells us before it moves (Will); Android only after (Did).
    const show = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hide = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const a = Keyboard.addListener(show, (e) => setInset(Math.max(0, Math.round(Dimensions.get("window").height - e.endCoordinates.screenY))));
    const b = Keyboard.addListener(hide, () => setInset(0));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return inset;
}

type Box = { top: number; bottom: number };

function measure(node: unknown): Promise<Box | null> {
  return new Promise((resolve) => {
    const n = node as { getBoundingClientRect?: () => DOMRect; measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (!n) return resolve(null);
    if (Platform.OS === "web" && n.getBoundingClientRect) {
      const r = n.getBoundingClientRect();
      return resolve({ top: r.top, bottom: r.bottom });
    }
    if (!n.measureInWindow) return resolve(null);
    n.measureInWindow((_x, y, _w, h) => resolve({ top: y, bottom: y + h }));
  });
}

function focusedField(): unknown {
  if (Platform.OS === "web") {
    const el = (globalThis as { document?: { activeElement?: { tagName?: string } | null } }).document?.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") ? el : null;
  }
  return TextInput.State.currentlyFocusedInput?.() ?? null;
}

// Keeps the focused field inside `scroll`'s visible part, with room for what follows it.
// Returns the scroll's onScroll, so it knows where the scroll is.
export function useKeepInView(scroll: RefObject<ScrollView | null>, inset: number) {
  const offset = useRef(0);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const keep = useCallback(async () => {
    const view = scroll.current as unknown as { getScrollableNode?: () => unknown } | null;
    if (!view) return;
    const field = focusedField();
    if (!field) return;
    const [f, s] = await Promise.all([measure(field), measure(Platform.OS === "web" ? view.getScrollableNode?.() : view)]);
    if (!f || !s) return;
    // What is visible of the scroll: its own box, cut off by the keyboard.
    const windowBottom = Platform.OS === "web" ? ((globalThis as { innerHeight?: number }).innerHeight ?? s.bottom) : Dimensions.get("window").height;
    const visibleBottom = Math.min(s.bottom, windowBottom - inset);
    const down = f.bottom + ROOM_BELOW - visibleBottom;
    const up = s.top + ROOM_ABOVE - f.top;
    // Lift the field and its button into view, but never past the top of the scroll.
    const by = down > 0 ? Math.min(down, f.top - (s.top + ROOM_ABOVE)) : up > 0 ? -up : 0;
    if (Math.abs(by) < 2) return;
    scroll.current?.scrollTo({ y: Math.max(0, offset.current + by), animated: true });
  }, [scroll, inset]);

  // The keyboard came up or changed height: after the frame has made room (next frame).
  useEffect(() => {
    if (inset <= 0) return;
    const t = setTimeout(() => void keep(), 60);
    return () => clearTimeout(t);
  }, [inset, keep]);

  // Focus moved to another field with the keyboard already up.
  useEffect(() => {
    if (Platform.OS === "web") {
      const doc = (globalThis as { document?: { addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } }).document;
      if (!doc) return;
      const on = () => setTimeout(() => void keep(), 60);
      doc.addEventListener("focusin", on);
      return () => doc.removeEventListener("focusin", on);
    }
    const sub = Keyboard.addListener("keyboardDidShow", () => void keep());
    return () => sub.remove();
  }, [keep]);

  return onScroll;
}
