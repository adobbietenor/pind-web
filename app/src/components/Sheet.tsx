// A sheet from the bottom of the screen over a dimmed page (UI pass 1: the room's info
// menu, the profile sheet). Tapping outside closes it.
import type { ReactNode } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { colors as palette, radius, spacing } from "@pind/shared";
import { Tap } from "./Tap";

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Tap accessibilityLabel="Close" style={styles.scrim} onPress={onClose}>
        <View />
      </Tap>
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={{ gap: spacing.md }}>{children}</ScrollView>
      </View>
    </Modal>
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
    bottom: 0,
    maxHeight: "85%",
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
  },
});
