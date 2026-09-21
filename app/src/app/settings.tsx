// A23 — Safety & settings. The M3.1 half: export my data, and delete my account.
// Blocked people, my reports, the women-only toggle and the five notification
// switches arrive with the milestones that create them (M3.3, M3.5).
//
// **The visibility line is not a setting.** "Visible only after I pin in and opt in"
// is how the product works, so it is stated, not offered — a toggle implies there is
// another way to be.
//
// **There is no location permission to manage**, because the app never asks for one
// (H4). Saying so on this screen is deliberate: the absence is invisible otherwise.
//
// Delete is a two-step confirm and says exactly what goes and what stays before the
// second tap. Everything in that list is Alex's decision, restated here rather than
// rediscovered (decisions Part 3, and M3.1).
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors as palette, fonts, radius, spacing } from "@pind/shared";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { deleteAccount, exportMyData } from "@/lib/profile";

export default function Settings() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [confirming, setConfirming] = useState(false);

  const runExport = async () => {
    setBusy("export");
    setError("");
    setDone("");
    try {
      const data = await exportMyData();
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === "web") {
        // A real download, because "export my data" that shows you a wall of text is
        // not an export.
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `pind-my-data-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: json });
      }
      setDone("That is everything we hold about you.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export did not work.");
    } finally {
      setBusy(null);
    }
  };

  const runDelete = async () => {
    setBusy("delete");
    setError("");
    try {
      await deleteAccount();
      router.replace("/crowds");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
      setBusy(null);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Heading>Safety &amp; settings</Heading>

        {error ? <Notice tone="stop">{error}</Notice> : null}
        {done ? <Notice>{done}</Notice> : null}

        <Text style={styles.sectionName}>Who can see you</Text>
        <View style={styles.card}>
          <Body>Visible only after you pin in and say you would like to meet — always on.</Body>
          <View style={{ marginTop: spacing.sm }}>
            <Body muted>
              Not a setting, because there is no other way to be. Nobody sees your name or your photo until you have both pinned
              in to the same gathering and both said you would like to meet.
            </Body>
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Body muted>There is no location permission to manage. Pin&#39;d never asks where you are.</Body>
          </View>
        </View>

        <Text style={styles.sectionName}>Your data</Text>
        <View style={styles.card}>
          <Body muted>
            A JSON file of everything we hold about you, read with your own account so it shows exactly what you can see. The
            reports are the ones you filed — your reason and the date, not the moderation decision, which is not yours.
          </Body>
          <View style={{ marginTop: spacing.md }}>
            <Button kind="quiet" label="Export my data" busy={busy === "export"} onPress={runExport} />
          </View>
        </View>

        <Text style={styles.sectionName}>Delete your account</Text>
        <View style={styles.card}>
          {!confirming ? (
            <>
              <Body muted>This cannot be undone.</Body>
              <View style={{ marginTop: spacing.md }}>
                <Button kind="quiet" label="Delete my account" onPress={() => setConfirming(true)} />
              </View>
            </>
          ) : (
            <>
              <Body>What goes</Body>
              <View style={{ marginTop: spacing.xs }}>
                <Body muted>
                  Your sign-in, your profile, your photo, your pins, your tags, your crews, your connections and the blocks you
                  made.
                </Body>
              </View>
              <View style={{ marginTop: spacing.md }}>
                <Body>What stays, and why</Body>
              </View>
              <View style={{ marginTop: spacing.xs }}>
                <Body muted>
                  Reports about you or by you, for twelve months, with your name removed — so a safety record does not disappear
                  when someone deletes an account.
                </Body>
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <Body muted>
                  Anything you wrote in a crew stays in that crew&#39;s conversation, shown as &ldquo;someone who left&rdquo;.
                  Removing your lines would rewrite a conversation other people are still reading.
                </Body>
              </View>
              <View style={{ marginTop: spacing.lg }}>
                <Button label="Yes, delete everything" busy={busy === "delete"} onPress={runDelete} />
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <Button kind="quiet" label="Keep my account" onPress={() => setConfirming(false)} />
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionName}>Coming with the rest</Text>
        <View style={styles.card}>
          <Body muted>
            Blocked people, the reports you have filed and women-only crews arrive with crews. The five notifications get their
            switches when they start being sent.
          </Body>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
  card: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionName: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginBottom: spacing.sm },
});
