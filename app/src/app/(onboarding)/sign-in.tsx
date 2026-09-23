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
import { useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  A1_POSITIONING,
  codeLengthMismatch,
  colors as palette,
  EMAIL_CODE_LENGTH,
  fonts,
  ONE_LINER,
  spacing,
} from "@pind/shared";
import { Brand } from "@/components/Brand";
import { Body, Button, Field, Heading, Notice } from "@/components/ui";
import { methodsFor, sendEmailCode, signInError, signInWithApple, signInWithGoogle, verifyEmailCode } from "@/lib/auth";
import { track } from "@/lib/analytics";

export default function SignIn() {
  const router = useRouter();
  const methods = methodsFor();
  // The email path is two steps on one screen: ask, then confirm. A separate route
  // would put a back button between a person and a code they are holding in their
  // head.
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const attempt = async (what: string, run: () => Promise<void>, then?: () => void) => {
    setBusy(what);
    setError("");
    try {
      await run();
      then?.();
    } catch (err) {
      // A cancelled Apple sheet is not an error and must not leave red text behind.
      setError(signInError(err));
    } finally {
      setBusy(null);
    }
  };

  const done = (method: string) => () => {
    track("sign_in", { method });
    router.replace("/you");
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Brand />
        <Heading>{ONE_LINER}</Heading>
        <View style={styles.positioning}>
          {A1_POSITIONING.map((line) => (
            <Text key={line} style={styles.positioningLine}>
              {line}
            </Text>
          ))}
        </View>

        {error ? <Notice tone="stop">{error}</Notice> : null}

        {methods.includes("apple") ? (
          <View style={{ marginBottom: spacing.sm }}>
            {Platform.OS === "web" ? (
              <AppleWebButton
                busy={busy === "apple"}
                // Like Google on the web: the page navigates to Apple and never comes
                // back to this handler. The return lands on /you, which counts it.
                onPress={() => attempt("apple", () => signInWithApple(`${window.location.origin}/you`))}
              />
            ) : (
              // Apple's own button, as their guidelines require.
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={12}
                style={{ height: 52 }}
                onPress={() => attempt("apple", signInWithApple, done("apple"))}
              />
            )}
          </View>
        ) : null}

        {methods.includes("google") ? (
          <View style={{ marginBottom: spacing.sm }}>
            <Button
              kind="quiet"
              label="Continue with Google"
              busy={busy === "google"}
              onPress={() =>
                attempt(
                  "google",
                  () => signInWithGoogle(Platform.OS === "web" ? `${window.location.origin}/you` : undefined),
                  // The web navigates away and never comes back to this handler; the
                  // app returns here with a session in hand.
                  Platform.OS === "web" ? undefined : done("google"),
                )
              }
            />
          </View>
        ) : null}

        <View style={styles.rule}>
          <Text style={styles.ruleLabel}>or</Text>
        </View>

        {!sent ? (
          <>
            <Field
              label="Email me a code"
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              value={email}
              onChangeText={setEmail}
            />
            <Button
              label="Send the code"
              busy={busy === "send"}
              disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
              onPress={() => attempt("send", () => sendEmailCode(email), () => setSent(true))}
            />
          </>
        ) : (
          <>
            <Field
              label={`The code we sent to ${email.trim()}`}
              placeholder={"1".repeat(EMAIL_CODE_LENGTH)}
              autoComplete="one-time-code"
              keyboardType="number-pad"
              inputMode="numeric"
              // **Deliberately longer than the code.** Capping the field at the
              // expected length is what made the mismatch invisible: a pasted
              // 8-digit code silently lost its last two digits and the screen just
              // said no. Let it in, then say what is wrong with it.
              maxLength={12}
              value={code}
              onChangeText={(text) => setCode(text.replace(/\D/g, ""))}
              hint={`${EMAIL_CODE_LENGTH} digits. It expires in an hour.`}
              error={code.length > EMAIL_CODE_LENGTH ? codeLengthMismatch(code.length) : undefined}
            />
            <Button
              label="Continue"
              busy={busy === "verify"}
              disabled={code.length !== EMAIL_CODE_LENGTH}
              onPress={() => attempt("verify", () => verifyEmailCode(email, code), done("email"))}
            />
            <View style={{ marginTop: spacing.sm }}>
              <Button
                kind="quiet"
                label="Use a different email"
                onPress={() => {
                  setSent(false);
                  setCode("");
                  setError("");
                }}
              />
            </View>
          </>
        )}

        <View style={{ marginTop: spacing.lg }}>
          <Body muted>No password, ever. We will not post anything or read your contacts.</Body>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Apple's native button does not exist on the web, so the web draws Apple's white
// style by hand, to the same size and corner as the native one: the logo and "Continue
// with Apple" in black on white (Apple's guidelines for the web). The logo is inlined —
// nothing on this page comes from another host.
const APPLE_LOGO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 814 1000"><path fill="#000" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 136.5-71.3z"/></svg>',
  );

function AppleWebButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Apple"
      accessibilityState={{ busy }}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.apple, pressed && !busy && { opacity: 0.85 }]}
    >
      {busy ? (
        <ActivityIndicator color="#000" />
      ) : (
        <>
          <Image source={{ uri: APPLE_LOGO }} style={styles.appleLogo} accessibilityIgnoresInvertColors />
          <Text style={styles.appleLabel}>Continue with Apple</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: spacing.lg, paddingTop: spacing.xl, gap: 0 },
  positioning: { marginTop: spacing.md, marginBottom: spacing.xl, gap: 6 },
  positioningLine: { fontSize: 15, color: palette.textMuted },
  rule: { alignItems: "center", marginVertical: spacing.md },
  ruleLabel: { fontSize: 13, color: palette.tabInactive },
  apple: {
    height: 52,
    borderRadius: 12,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  appleLogo: { width: 16, height: 20, marginTop: -2 },
  appleLabel: { fontSize: 19, fontWeight: "500", color: "#000" },
});
