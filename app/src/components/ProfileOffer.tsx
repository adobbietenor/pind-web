// The profile offer for someone without one (UI pass 1, 022 A5 and 038 A21 signed out):
// at the bottom, above the tab bar. "No profile needed to pin in.", what each step buys in
// three icon lines, and one full-width button. A21 adds a quiet "Already on Pin'd? Sign
// in" row under it.
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, PROFILE_OFFER, radius, spacing } from "@pind/shared";
import { Icon } from "./Icon";
import { Tap } from "./Tap";

export function ProfileOffer({ onSetUp, onSignIn }: { onSetUp: () => void; onSignIn?: () => void }) {
  return (
    <View style={styles.box}>
      <Text style={styles.heading}>{PROFILE_OFFER.heading}</Text>
      {PROFILE_OFFER.lines.map((l) => (
        <View key={l.lead} style={styles.line}>
          <Icon name={l.icon} size={18} color={palette.accentText} />
          <Text style={styles.text}>
            <Text style={styles.lead}>{l.lead}</Text> {l.rest}
          </Text>
        </View>
      ))}
      <Tap accessibilityRole="button" onPress={onSetUp} style={styles.button}>
        <Icon name="person" size={18} color={palette.onAccent} />
        <Text style={styles.buttonLabel}>{PROFILE_OFFER.button}</Text>
      </Tap>
      {onSignIn ? (
        <View style={styles.signInRow}>
          <Text style={styles.signInLine}>{PROFILE_OFFER.alreadyOnPind}</Text>
          <Tap accessibilityRole="button" onPress={onSignIn} style={styles.signIn}>
            <Text style={styles.signInLabel}>{PROFILE_OFFER.signIn}</Text>
          </Tap>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: "auto",
    padding: spacing.md,
    gap: spacing.sm + 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  heading: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  line: { flexDirection: "row", gap: spacing.sm + 2, alignItems: "flex-start" },
  text: { flex: 1, fontSize: 14, lineHeight: 19, color: palette.textMuted },
  lead: { fontFamily: fonts.headline, color: palette.text },
  button: {
    marginTop: spacing.xs,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: palette.accent,
  },
  buttonLabel: { fontFamily: fonts.headline, fontSize: 16, color: palette.onAccent },
  signInRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.sm },
  signInLine: { fontSize: 14, color: palette.textMuted },
  signIn: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  signInLabel: { fontFamily: fonts.headline, fontSize: 15, color: palette.accentText },
});
