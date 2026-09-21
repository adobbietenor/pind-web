// A3 — Neighbourhood and tags.
//
// **The database caps at 3 and asks for none; this screen asks for exactly 3** (V19,
// Alex M3.1). "Exactly 3" is what a complete profile means, and a minimum in the
// database would make a pin impossible on the link path, where a profile is
// deliberately incomplete. So the counter here is a request, and the cap underneath
// it is a rule — a session token can walk around a form and cannot walk around a
// trigger.
//
// **Tags are conversation handles, not match criteria** (spec A3). There is no
// matching anywhere in Pin'd, and the copy never implies there is: these are things
// to say, not things to be sorted by.
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
import { colors as palette, fonts, NEIGHBOURHOODS, radius, spacing, TAGS, TAGS_PER_PROFILE } from "@pind/shared";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function Where() {
  const router = useRouter();
  const [hood, setHood] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const full = picked.length >= TAGS_PER_PROFILE;
  const toggle = (slug: string) =>
    setPicked((was) => (was.includes(slug) ? was.filter((s) => s !== slug) : was.length >= TAGS_PER_PROFILE ? was : [...was, slug]));

  const finish = async (save: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (save && (hood || picked.length)) {
        const db = supabase();
        const { data: session } = await db.auth.getUser();
        const { data: me } = await db.from("people").select("id").eq("auth_user_id", session.user!.id).maybeSingle();
        if (!me) throw new Error("Sign in again — this session has expired.");
        if (hood) {
          const { error: saveError } = await db.from("people").update({ neighbourhood: hood }).eq("id", me.id);
          if (saveError) throw saveError;
        }
        if (picked.length) {
          // Replace rather than merge: this screen is the whole answer, and the
          // database refuses a fourth row anyway.
          await db.from("person_tags").delete().eq("person_id", me.id);
          const { error: tagError } = await db
            .from("person_tags")
            .insert(picked.map((tag) => ({ person_id: me.id, tag })));
          if (tagError) throw tagError;
        }
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

        <View style={{ marginTop: spacing.xl }}>
          <Heading>Three things to say</Heading>
        </View>
        <View style={{ marginBottom: spacing.md }}>
          <Body muted>
            They are conversation starters, not a filter — nothing here sorts anyone. Pick {TAGS_PER_PROFILE}.
          </Body>
        </View>
        {TAGS.map((group) => (
          <View key={group.group} style={{ marginBottom: spacing.md }}>
            <Text style={styles.groupName}>{group.group}</Text>
            <View style={styles.hoods}>
              {group.tags.map((t) => {
                const on = picked.includes(t.slug);
                return (
                  <Pressable
                    key={t.slug}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: !on && full }}
                    onPress={() => toggle(t.slug)}
                    style={[styles.hood, on && styles.hoodOn, !on && full && { opacity: 0.4 }]}
                  >
                    <Text style={[styles.hoodLabel, on && { color: palette.onAccent }]}>{t.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        <View style={{ marginTop: spacing.sm }}>
          <Body muted>
            {picked.length} of {TAGS_PER_PROFILE} picked{full ? " — that is a complete profile." : ""}
          </Body>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Button label="Continue" busy={busy} disabled={!hood && !picked.length} onPress={() => finish(true)} />
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
  groupName: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginBottom: spacing.sm },
});
