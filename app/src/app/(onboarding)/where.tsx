// A3 — Neighbourhood and tags.
//
// **The neighbourhood half is here; the tags half is waiting on a rule.** Reading
// somebody's tags is a visibility question (who may see the three words on your
// profile), and in this repo a visibility question is a policy in the database with
// harness cases on both sides before any screen shows it (H11, CLAUDE.md). `tags` and
// `person_tags` are still locked to visitors — the M3.1 seed deliberately added no
// privileges — so the picker goes in with the migration that opens them.
//
// **Neither half is ever a gate before a pin** (decisions Part 5, "Neighbourhood and
// tags on the link path"): "exactly 3" is what a *complete* profile means, and the
// link path is nudged later. So Skip is a real button, not a dark-pattern one.
//
// "Pin'd never asks where you are" — the neighbourhood is a fixed list and is shown
// instead of a location, because there is no location permission to grant (H4).
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors as palette, NEIGHBOURHOODS, radius, spacing } from "@pind/shared";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function Where() {
  const router = useRouter();
  const [hood, setHood] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const finish = async (save: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (save && hood) {
        const db = supabase();
        const { data: session } = await db.auth.getUser();
        const { error: saveError } = await db
          .from("people")
          .update({ neighbourhood: hood })
          .eq("auth_user_id", session.user!.id);
        if (saveError) throw saveError;
      }
      router.replace("/crowds");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Heading>Where in the city?</Heading>
        <View style={{ marginBottom: spacing.lg }}>
          <Body muted>Pin&#39;d never asks where you are. Pick the part of town you would say you are from — it gives a crew something to start with.</Body>
        </View>

        {error ? <Notice tone="stop">{error}</Notice> : null}

        <View style={styles.hoods}>
          {NEIGHBOURHOODS.map((n) => {
            const on = n.slug === hood;
            return (
              <Pressable
                key={n.slug}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setHood(on ? null : n.slug)}
                style={[styles.hood, on && styles.hoodOn]}
              >
                <Text style={[styles.hoodLabel, on && { color: palette.onAccent }]}>{n.name}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Button label="Continue" busy={busy} disabled={!hood} onPress={() => finish(true)} />
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <Button kind="quiet" label="Skip for now" onPress={() => finish(false)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl },
  hoods: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  hood: {
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  hoodOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  hoodLabel: { fontSize: 15, color: palette.text },
});
