// A26 — Quick pin. Holding state (M2.1); the real screen arrives in M3.2.
//
// W2's one button lands here, so from M2.1 this URL is live on pind.social and
// reachable from every shared link. Without this screen the app shell renders empty
// and anyone arriving from a Reddit thread would reasonably think the product is
// broken — which is worse than saying plainly that it is not open yet.
//
// It asks for nothing and stores nothing: no session, no anonymous user, no fields.
// A26 creates the anonymous user, and A26 does not exist yet.
//
// It also promises no date. M3.2 is two milestones away, and a page a stranger reads
// is not the place to guess at one.
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { colors as palette, fonts, radius, spacing, THRESHOLD } from "@pind/shared";
import { Screen } from "@/components/Screen";

export default function QuickPinHolding() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const backToCrowd = typeof slug === "string" && slug ? `/g/${slug}` : "/";

  return (
    <Screen title="Almost open">
      <View style={styles.body}>
        <Text style={styles.lede}>
          Pinning in isn&#39;t open yet. Nothing to sign up for in the meantime, and nothing to miss.
        </Text>
        <Text style={styles.detail}>
          When it opens it takes about thirty seconds: your first name, who&#39;s coming with you, and whether
          you&#39;d like to meet people. No account, no photo, nothing to download. Crews open once {THRESHOLD}{" "}
          people say they&#39;d like to meet, and you can change your mind at any point.
        </Text>

        <Pressable
          accessibilityRole="link"
          style={styles.button}
          onPress={() => {
            void Linking.openURL(backToCrowd);
          }}
        >
          <Text style={styles.buttonText}>Back to the crowd page</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: spacing.md, gap: spacing.md },
  lede: { color: palette.text, fontSize: 17, lineHeight: 26 },
  detail: { color: palette.textMuted, fontSize: 15, lineHeight: 24 },
  button: {
    marginTop: spacing.sm,
    backgroundColor: palette.accent,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonText: { color: palette.onAccent, fontFamily: fonts.headline, fontSize: 16 },
});
