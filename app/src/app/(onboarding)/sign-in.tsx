// A1 — Sign in (store path). Apple / Google / a six-digit email code. **No password
// field anywhere**, on any platform (spec A1, build-plan §8 M3.1).
//
// The three positioning lines are on this screen and this screen alone: "not a dating
// app" is written once in the whole product, here, and nowhere else (spec §5).
//
// Which methods appear is a platform fact, not a preference — see `signInMethods` in
// @pind/shared. Apple is on the web too (Alex, M3.1): it was built and then never
// rendered there, because the table still said "later".
//
// **Over an anonymous session, A1 is the link** (#11): the mode comes from
// `identityModeFor`, read from the device before a button is drawn. Signing in over a
// quick pin's session used to leave that person behind, pin and all, counted twice.
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { A1_POSITIONING, colors as palette, identityModeFor, ONE_LINER, spacing, type IdentityMode } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { IdentityStep } from "@/components/profile/IdentityStep";
import { Heading } from "@/components/ui";
import { track } from "@/lib/analytics";
import { finishWebReturn, RETURN_SAYS, type Provider } from "@/lib/merge";
import { report } from "@/lib/sentry";
import { claimOnce } from "@/lib/session";
import { supabase } from "@/lib/supabase";

// The sign-in itself is the shared "identity" step (components/profile), the same one
// A27 draws — one set of buttons, one email-code flow, one sentence naming the address.
export default function SignIn() {
  const router = useRouter();
  const [mode, setMode] = useState<IdentityMode | null>(null);
  const [hasAccount, setHasAccount] = useState<Provider | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      // A hand-off that cannot be fetched (offline) leaves whatever session is here.
      await claimOnce().catch(() => undefined);
      // Back from Apple or Google in link mode: finish the merge it left for, or move on.
      const back = await finishWebReturn();
      if (!live) return;
      if (back.kind === "merged" || back.kind === "linked") {
        track("sign_in", back.kind === "linked" ? { method: back.provider } : { merged: true });
        router.replace("/you");
        return;
      }
      if (back.kind === "has-account") setHasAccount(back.provider);
      if (back.kind === "merge-failed" || back.kind === "link-failed") setNotice(RETURN_SAYS[back.kind]);
      const { data } = await supabase().auth.getSession();
      if (live) setMode(identityModeFor(data.session));
    })().catch((err) => {
      // Unreadable: the link is the safe side — it never leaves a pin behind, and for
      // someone with no session it fails plainly rather than signing in over anything.
      report(err, "open A1");
      if (live) setMode("link");
    });
    return () => {
      live = false;
    };
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {mode === null ? (
        <ActivityIndicator style={{ marginTop: spacing.lg }} color={palette.textMuted} />
      ) : (
        <IdentityStep
          mode={mode}
          returnTo={mode === "link" ? "/sign-in" : "/you"}
          hasAccount={hasAccount}
          notice={notice}
          onDone={({ method, merged }) => {
            track("sign_in", { method, merged });
            router.replace("/you");
          }}
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  positioning: { marginTop: spacing.md, marginBottom: spacing.xl, gap: 6 },
  positioningLine: { fontSize: 15, color: palette.textMuted },
});
