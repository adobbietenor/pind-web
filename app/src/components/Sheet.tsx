// A sheet from the bottom of the screen over a dimmed page (UI pass 1: the room's info
// menu, the profile sheet, the squad form, a place or a time). Tapping outside closes it.
//
// **Every sheet is this frame** (UI pass 1, round 2): the squad form was a Modal of its
// own with nothing that knew about the keyboard, and its fields sat under it on the
// phone. So the one frame stands on the keyboard's top edge (components/keyboard.ts),
// never taller than what is left above it, and keeps the focused field and the button
// under it in view. S53 fails if a component opens a Modal of its own.
import { useRef, type ReactNode } from "react";
import { Dimensions, Modal, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors as palette, radius, spacing } from "@pind/shared";
import { useKeepInView, useKeyboardInset } from "./keyboard";
import { Tap } from "./Tap";

export function SheetFrame({
  visible,
  onClose,
  children,
  style,
  contentStyle,
  animation = "fade",
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  animation?: "fade" | "slide";
}) {
  const ref = useRef<ScrollView>(null);
  const inset = useKeyboardInset();
  const safe = useSafeAreaInsets();
  const onScroll = useKeepInView(ref, inset);
  const windowHeight = Platform.OS === "web" ? ((globalThis as { innerHeight?: number }).innerHeight ?? Dimensions.get("window").height) : Dimensions.get("window").height;
  // What is left above the keyboard, less the status bar and a strip of the page behind.
  const tallest = Math.max(240, windowHeight - inset - safe.top - spacing.xl);
  return (
    <Modal visible={visible} transparent animationType={animation} onRequestClose={onClose}>
      <Tap accessibilityLabel="Close" style={styles.scrim} onPress={onClose}>
        <View />
      </Tap>
      <View style={[styles.sheet, { bottom: inset, maxHeight: tallest, paddingBottom: inset > 0 ? spacing.md : Math.max(spacing.lg, safe.bottom) }, style]}>
        <ScrollView
          ref={ref}
          contentContainerStyle={[{ gap: spacing.md }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={64}
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <SheetFrame visible={visible} onClose={onClose}>
      {children}
    </SheetFrame>
  );
}

// A row that scrolls sideways (the room's faces).
export function SideScroll({ children, gap = spacing.md }: { children: ReactNode; gap?: number }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap, paddingVertical: spacing.md }}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
  },
});
