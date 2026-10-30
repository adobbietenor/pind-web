// "Already on Pin'd?" in its short form (UI pass 1: 024 A27 step 1, 038 A21 signed out):
// one bold line and a Sign in button, no subtitle.
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, OPTIN_COPY, radius, spacing } from "@pind/shared";
import { Tap } from "./Tap";

export function AlreadyOnPind({ onSignIn }: { onSignIn: () => void }) {
  return (
    <View style={styles.box}>
      <Text style={styles.line}>{OPTIN_COPY.alreadyOnPind}</Text>
      <Tap accessibilityRole="button" onPress={onSignIn} style={styles.button}>
        <Text style={styles.label}>{OPTIN_COPY.signIn}</Text>
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  line: { fontFamily: fonts.headline, fontSize: 18, color: palette.text, flexShrink: 1 },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: palette.accent },
  label: { fontFamily: fonts.headline, fontSize: 15, color: palette.onAccent },
});
