// The shell every scrolling app screen sits in (M3.1, after the TestFlight walk).
//
// **Two faults, one cause: every screen built its own frame.** The Profile tab had no
// header because it was the one screen that forgot the Brand row, and the keyboard
// covered the email-code field because no screen's ScrollView knew about the
// keyboard. Fixing either per screen would leave the next screen to forget again, so
// the frame is one component and `tests/unit/screens.test.ts` fails the build if a
// route draws its own SafeAreaView or ScrollView instead.
//
//   * The header (the mark at one end, the wordmark at the other) is always first.
//   * **The keyboard** (UI pass 1, round 2): the frame gives up exactly the part of the
//     window the keyboard covers (components/keyboard.ts), on iOS and on the web alike, so
//     the scroll ends at the keyboard's top edge; then the focused field, and room for the
//     button under it, is scrolled into view. A drag puts the keyboard away.
//   * Taps on a button while the keyboard is up still land (`handled`), so "Send the
//     code" works first time rather than only dismissing the keyboard.
//   * **Every screen and every step opens at the top** (UI pass 1, round 2). A route is a
//     new frame and starts there; a step is not (A27's steps, Where's two pages, the code
//     after the email), so a step that kept the last one's scroll opened at its foot. A
//     route that changes step passes `step` to the frame; a component inside the frame
//     calls `useStepTop(step)`; S56 fails either that does not.
//
// **A screen with a `footer` is a conversation** (the room, a squad, a 1-on-1: the
// thread pass, 16 Oct 2026). The box is not in the scroll at all. It is the footer, and
// the frame keeps it on the keyboard's top edge, the same room made the same way;
//   * the scroll keeps the newest message in view (at the end when it opens, when a
//     message arrives, when the box grows and when the keyboard comes up) unless you
//     have scrolled up to read, in which case it leaves you where you are. The footer's
//     box asks for the end itself when you focus it or send (`useScrollToEnd`).
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets, type Edge } from "react-native-safe-area-context";
import { colors as palette, spacing } from "@pind/shared";
import { Brand } from "./Brand";
import { useKeepInView, useKeyboardInset } from "./keyboard";

// Within this of the end counts as "at the end": reading the last message, not history.
const NEAR_END = 96;

const ScrollToEnd = createContext<() => void>(() => undefined);
// For whatever is in a footer: bring the conversation back to its newest message.
export const useScrollToEnd = () => useContext(ScrollToEnd);

const ScrollToTop = createContext<() => void>(() => undefined);
// For a component with steps: each new step opens at the top of the page.
export function useStepTop(step: unknown) {
  const toTop = useContext(ScrollToTop);
  useEffect(() => {
    toTop();
  }, [step, toTop]);
}

// The room the keyboard needs at the foot of the frame: what it covers, less the safe
// area the frame already leaves at the bottom (the keyboard covers that too).
function useKeyboardRoom(edges: Edge[]): { inset: number; room: number } {
  const inset = useKeyboardInset();
  const bottom = useSafeAreaInsets().bottom;
  return { inset, room: Math.max(0, inset - (edges.includes("bottom") ? bottom : 0)) };
}

export function AppScreen({
  children,
  edges = ["top", "bottom"],
  contentStyle,
  scroll = true,
  footer,
  step,
}: {
  children?: ReactNode;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  // A route with steps of its own (A27, the quick pin): each new one opens at the top.
  step?: string | number | boolean;
  // A screen with nothing to scroll (a loading state) still gets the header.
  scroll?: boolean;
  // A conversation's box: kept on the keyboard, outside the scroll (see above).
  footer?: ReactNode;
}) {
  if (footer && scroll) return <Conversation edges={edges} contentStyle={contentStyle} footer={footer}>{children}</Conversation>;
  if (!scroll) {
    return (
      <SafeAreaView edges={edges} style={styles.root}>
        <View style={[styles.body, contentStyle]}>
          <Brand />
          {children}
        </View>
      </SafeAreaView>
    );
  }
  return <Page edges={edges} contentStyle={contentStyle} step={step}>{children}</Page>;
}

function Page({ children, edges, contentStyle, step }: { children?: ReactNode; edges: Edge[]; contentStyle?: StyleProp<ViewStyle>; step?: string | number | boolean }) {
  const ref = useRef<ScrollView>(null);
  const { inset, room } = useKeyboardRoom(edges);
  const onScroll = useKeepInView(ref, inset);
  const toTop = useCallback(() => ref.current?.scrollTo({ y: 0, animated: false }), []);
  useEffect(toTop, [step, toTop]);
  return (
    <ScrollToTop.Provider value={toTop}>
      <SafeAreaView edges={edges} style={styles.root}>
        <View style={[styles.fill, { paddingBottom: room }]}>
          <ScrollView
            ref={ref}
            style={styles.fill}
            contentContainerStyle={[styles.body, contentStyle]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
            onScroll={onScroll}
            scrollEventThrottle={64}
          >
            <Brand />
            {children}
          </ScrollView>
        </View>
      </SafeAreaView>
    </ScrollToTop.Provider>
  );
}

function Conversation({ children, edges, contentStyle, footer }: { children?: ReactNode; edges: Edge[]; contentStyle?: StyleProp<ViewStyle>; footer: ReactNode }) {
  const ref = useRef<ScrollView>(null);
  // Starts true: a conversation opens on its newest message.
  const atEnd = useRef(true);
  const { room } = useKeyboardRoom(edges);

  const follow = useCallback(() => {
    if (atEnd.current) ref.current?.scrollToEnd({ animated: false });
  }, []);
  const toEnd = useCallback(() => {
    atEnd.current = true;
    ref.current?.scrollToEnd({ animated: true });
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atEnd.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_END;
  }, []);
  // The keyboard came up or went down: the newest message stays just over the box.
  useEffect(follow, [room, follow]);

  return (
    <ScrollToEnd.Provider value={toEnd}>
      <SafeAreaView edges={edges} style={styles.root}>
        <View style={[styles.fill, { paddingBottom: room }]}>
          <ScrollView
            ref={ref}
            style={styles.fill}
            contentContainerStyle={[styles.body, styles.threadBody, contentStyle]}
            keyboardShouldPersistTaps="handled"
            // iOS: a drag puts the keyboard away. Not "interactive": the footer rides the
            // keyboard's frame, and an interactive drag would leave it floating while the
            // keyboard follows the finger. **Never on the web**: React Native Web dismisses on
            // ANY scroll, its own included, so following the newest message as the box grew
            // or a message arrived blurred the box mid-word (caught in real Chrome: every
            // other new line was lost; the phone's keyboard would have closed).
            keyboardDismissMode={Platform.OS === "ios" ? "on-drag" : "none"}
            onScroll={onScroll}
            scrollEventThrottle={64}
            // New content (a message, an older page loaded above) or a smaller window (the
            // keyboard, a taller box): stay on the newest message only if already there.
            onContentSizeChange={follow}
            onLayout={follow}
          >
            <Brand />
            {children}
          </ScrollView>
          <View style={styles.footer}>{footer}</View>
        </View>
      </SafeAreaView>
    </ScrollToEnd.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  fill: { flex: 1 },
  // Room under the last field, so the keyboard has something to scroll it clear of.
  body: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl * 2 },
  // In a conversation the box is below the scroll, not in it: no room needed under the last message.
  threadBody: { paddingBottom: spacing.md },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.background,
  },
});
