// A21 — Profile (self), at /me. Still a scaffold (M2.0): the profile itself is the
// rest of M3.1.
//
// The one live thing on it is the way into the store-path onboarding (A1–A3), so the
// flow is walkable on a real phone before the tab that will normally lead here
// exists. A5–A7 and the pin that creates a session are M3.2.
import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, radius, spacing } from "@pind/shared";
import { Screen } from "@/components/Screen";

export default function Profile() {
  return (
    <Screen title="Profile">
      <View style={styles.card}>
        <Text style={styles.body}>Nothing here yet. Set yourself up and people you meet will have a face and a first name to go on.</Text>
        <Link href="/sign-in" style={styles.link}>
          Set up your profile
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  body: { color: palette.textMuted, fontSize: 15, lineHeight: 22, marginBottom: spacing.md },
  link: { fontFamily: fonts.headline, fontSize: 16, color: palette.accentText },
});
