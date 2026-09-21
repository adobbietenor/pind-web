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
import { colors as palette, fonts, NEIGHBOURHOODS, radius, spacing, TAGS_MINIMUM } from "@pind/shared";
import { Brand } from "@/components/Brand";
import { TagPicker, enoughPicked, type Picked } from "@/components/TagPicker";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { oneLine, failed } from "@/lib/errors";
import { saveTags } from "@/lib/tags";
import { supabase } from "@/lib/supabase";

export default function Where() {
  const router = useRouter();
  const [hood, setHood] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

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
        if (picked.length) await saveTags(me.id, picked);
      }
      router.replace("/crowds");
    } catch (err) {
      setError(oneLine(failed("save that", err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Brand />
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
          <Heading>A few things to say</Heading>
        </View>
        <View style={{ marginBottom: spacing.md }}>
          <Body muted>
            Conversation starters, not a filter — nothing here sorts anyone. Pick at least {TAGS_MINIMUM}.
          </Body>
        </View>
        {note ? <Notice>{note}</Notice> : null}
        <TagPicker picked={picked} onChange={setPicked} onSay={setNote} />

        <View style={{ marginTop: spacing.lg }}>
          <Button
            label="Continue"
            busy={busy}
            // Tags are never a gate before a pin, so Continue works with none at
            // all — but if somebody has started picking, the screen asks for the
            // three it said it wanted rather than saving one and moving on.
            disabled={picked.length > 0 && !enoughPicked(picked)}
            onPress={() => finish(true)}
          />
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
