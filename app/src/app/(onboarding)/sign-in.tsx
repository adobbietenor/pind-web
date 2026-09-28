// A1 — Sign in (store path). Apple / Google / a six-digit email code. **No password
// field anywhere**, on any platform (spec A1, build-plan §8 M3.1).
//
// The three positioning lines are on this screen and this screen alone: "not a dating
// app" is written once in the whole product, here, and nowhere else (spec §5).
//
// Which methods appear is a platform fact, not a preference — see `signInMethods` in
// @pind/shared. Apple is on the web too (Alex, M3.1): it was built and then never
// rendered there, because the table still said "later".
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { A1_POSITIONING, colors as palette, ONE_LINER, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { IdentityStep } from "@/components/profile/IdentityStep";
import { Heading } from "@/components/ui";
import { track } from "@/lib/analytics";

// The sign-in itself is the shared "identity" step (components/profile), the same one
// A27 draws — one set of buttons, one email-code flow, one sentence naming the address.
export default function SignIn() {
  const router = useRouter();
  return (
    <AppScreen edges={["top", "bottom"]}>
      <Heading>{ONE_LINER}</Heading>
      <View style={styles.positioning}>
        {A1_POSITIONING.map((line) => (
          <Text key={line} style={styles.positioningLine}>
            {line}
          </Text>
        ))}
      </View>
      <IdentityStep
        mode="sign-in"
        returnTo="/you"
        onDone={({ method }) => {
          track("sign_in", { method });
          router.replace("/you");
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  positioning: { marginTop: spacing.md, marginBottom: spacing.xl, gap: 6 },
  positioningLine: { fontSize: 15, color: palette.textMuted },
});
