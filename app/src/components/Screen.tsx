import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors as palette, fonts, spacing } from "@pind/shared";

// The shell every tab screen sits in: a Poppins headline on the scheme's background.
export function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <SafeAreaView edges={["top"]} style={[styles.root, { backgroundColor: palette.background }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
        {title}
      </Text>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  title: {
    fontFamily: fonts.headline,
    fontSize: 28,
    lineHeight: 36,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  body: { flex: 1, paddingHorizontal: spacing.md },
});
