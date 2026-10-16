// The shell every scrolling app screen sits in (M3.1, after the TestFlight walk).
//
// **Two faults, one cause: every screen built its own frame.** The Profile tab had no
// header because it was the one screen that forgot the Brand row, and the keyboard
// covered the email-code field because no screen's ScrollView knew about the
// keyboard. Fixing either per screen would leave the next screen to forget again, so
// the frame is one component and `tests/unit/screens.test.ts` fails the build if a
// route draws its own SafeAreaView or ScrollView instead.
//
//   * The header — the mark at one end, the wordmark at the other — is always first.
//   * `automaticallyAdjustKeyboardInsets` (iOS) insets the scroll view by the
//     keyboard's height and keeps the focused field in view; `keyboardDismissMode`
//     lets a drag put the keyboard away. On the web the browser does this itself.
//   * Taps on a button while the keyboard is up still land (`handled`), so "Send the
//     code" works first time rather than only dismissing the keyboard.
//
// **A screen with a `footer` is a conversation** (the room, a squad, a 1-on-1 plan — the
// thread pass, 16 Oct 2026). A box at the foot of a scrolling page grew under the
// keyboard: a three-line message hid what you were typing and the Send button with it.
// So the box is not in the scroll at all. It is the footer, and the frame keeps it on
// top of the keyboard:
//   * iOS: the scroll and the footer sit in a KeyboardAvoidingView inside the safe area,
//     which lifts both by exactly the keyboard's overlap — so the scroll view no longer
//     insets itself as well (that would count the keyboard twice);
//   * the web: the frame is sized to the visual viewport, which a phone's on-screen
//     keyboard shrinks, so the footer sits on the keyboard instead of behind it;
//   * the scroll keeps the newest message in view — at the end when it opens, when a
//     message arrives, when the box grows and when the keyboard comes up — unless you
//     have scrolled up to read, in which case it leaves you where you are. The footer's
//     box asks for the end itself when you focus it or send (`useScrollToEnd`).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { colors as palette, spacing } from "@pind/shared";
import { Brand } from "./Brand";

// Within this of the end counts as "at the end": reading the last message, not history.
const NEAR_END = 96;

const ScrollToEnd = createContext<() => void>(() => undefined);
// For whatever is in a footer: bring the conversation back to its newest message.
export const useScrollToEnd = () => useContext(ScrollToEnd);

export function AppScreen({
  children,
  edges = ["top", "bottom"],
  contentStyle,
  scroll = true,
  footer,
}: {
  children?: ReactNode;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  // A screen with nothing to scroll (a loading state) still gets the header.
  scroll?: boolean;
  // A conversation's box: kept on the keyboard, outside the scroll (see above).
  footer?: ReactNode;
}) {
  if (footer && scroll) return <Conversation edges={edges} contentStyle={contentStyle} footer={footer}>{children}</Conversation>;
  return (
    <SafeAreaView edges={edges} style={styles.root}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.body, contentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <Brand />
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, contentStyle]}>
          <Brand />
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

function Conversation({ children, edges, contentStyle, footer }: { children?: ReactNode; edges: Edge[]; contentStyle?: StyleProp<ViewStyle>; footer: ReactNode }) {
  const ref = useRef<ScrollView>(null);
  // Starts true: a conversation opens on its newest message.
  const atEnd = useRef(true);
  const viewport = useVisualViewportHeight();

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

  return (
    <ScrollToEnd.Provider value={toEnd}>
      <SafeAreaView edges={edges} style={[styles.root, viewport !== null && { maxHeight: viewport }]}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            ref={ref}
            style={styles.fill}
            contentContainerStyle={[styles.body, styles.threadBody, contentStyle]}
            keyboardShouldPersistTaps="handled"
            // iOS: a drag puts the keyboard away. Not "interactive": the footer rides the
            // keyboard's frame, and an interactive drag would leave it floating while the
            // keyboard follows the finger. **Never on the web**: React Native Web dismisses on
            // ANY scroll, its own included — so following the newest message as the box grew
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
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScrollToEnd.Provider>
  );
}

// The web only: the height a phone's on-screen keyboard leaves. The layout viewport does
// not shrink for it (iOS Safari), so a footer at its foot would sit behind the keyboard.
// Null elsewhere, and on a desktop browser it is simply the window's height.
function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const vv = (globalThis as { visualViewport?: VisualViewport }).visualViewport;
    if (!vv) return;
    const fit = () => {
      setHeight(Math.round(vv.height));
      // Safari pans the page to show the focused box; the frame already fits, so undo the pan.
      if (vv.offsetTop > 0) globalThis.scrollTo?.(0, 0);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);
  return height;
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
