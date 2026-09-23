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
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  A1_POSITIONING,
  codeLengthMismatch,
  colors as palette,
  EMAIL_CODE_LENGTH,
  fonts,
  ONE_LINER,
  spacing,
} from "@pind/shared";
import { SignInButton } from "@/components/SignInButton";
import { AppScreen } from "@/components/AppScreen";
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
      // Which step failed decides the sentence: only entering a code can say a code
      // expired (S05–S07). A cancelled sheet says nothing at all.
      setError(signInError(what === "send" ? "send" : what === "verify" ? "verify" : "oauth", err));
    } finally {
      setBusy(null);
    }
  };

  const done = (method: string) => () => {
    track("sign_in", { method });
    router.replace("/you");
  };

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

        {error ? <Notice tone="stop">{error}</Notice> : null}

        {methods.includes("apple") ? (
          <View style={{ marginBottom: spacing.sm }}>
            {/* One button on both platforms (Alex, M3.1: the web is the reference).
                Apple's system button centres its logo and scales it with the button's
                height, so in the app it could never match the web's. A custom button
                with Apple's own logo file is what the HIG allows for exactly this —
                aligning logos across several sign-in buttons. */}
            <SignInButton
              provider="apple"
              busy={busy === "apple"}
              onPress={() =>
                Platform.OS === "web"
                  ? // The page navigates to Apple and never comes back to this handler.
                    attempt("apple", () => signInWithApple(`${window.location.origin}/you`))
                  : attempt("apple", () => signInWithApple(), done("apple"))
              }
            />
          </View>
        ) : null}

        {methods.includes("google") ? (
          <View style={{ marginBottom: spacing.sm }}>
            <SignInButton
              provider="google"
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
      </AppScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: spacing.lg, paddingTop: spacing.xl, gap: 0 },
  positioning: { marginTop: spacing.md, marginBottom: spacing.xl, gap: 6 },
  positioningLine: { fontSize: 15, color: palette.textMuted },
  rule: { alignItems: "center", marginVertical: spacing.md },
  ruleLabel: { fontSize: 13, color: palette.tabInactive },
});
