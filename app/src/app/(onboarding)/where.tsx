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
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, NEIGHBOURHOODS, radius, spacing, TAGS_MINIMUM, TAGS_NEED_MORE } from "@pind/shared";
import { TagPicker, tagsCanContinue, type Picked } from "@/components/TagPicker";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { myAuthId } from "@/lib/session";
import { saveTags } from "@/lib/tags";
import { supabase } from "@/lib/supabase";

export default function Where() {
  const router = useRouter();
  const [hood, setHood] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Described | null>(null);

  const finish = async (save: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (save && (hood || picked.length)) {
        const db = supabase();
        // Read from this device (session.ts): offline used to be "this session has
        // expired" — or a crash on a null user — for a session that was fine (M3.1).
        const authUserId = await myAuthId();
        const { data: me, error: meError } = await db.from("people").select("id").eq("auth_user_id", authUserId).maybeSingle();
        if (meError) throw meError;
        // Signed in, but A2 never saved: the true sentence, not "expired".
        if (!me) throw new Error("your profile from the last screen is not saved yet. Go back a step and tap Continue again");
        if (hood) {
          const { error: saveError } = await db.from("people").update({ neighbourhood: hood }).eq("id", me.id);
          if (saveError) throw saveError;
        }
        if (picked.length) await saveTags(me.id, picked);
      }
      router.replace("/crowds");
    } catch (err) {
      setError(failed("save that", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppScreen edges={["top", "bottom"]}>
        <Heading>Where in the city?</Heading>
        <View style={{ marginBottom: spacing.lg }}>
          <Body muted>Pin&#39;d never asks where you are. Pick the part of town you would say you are from — it gives a crew something to start with.</Body>
        </View>

        {error ? <Trouble what={error} onRetry={() => finish(true)} busy={busy} /> : null}

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
        <TagPicker picked={picked} onChange={setPicked} />

        <View style={{ marginTop: spacing.lg }}>
          <Button
            label="Continue"
            busy={busy}
            // The shared rule, and only the shared rule (T10): three to ten. Leaving
            // with none is what "Skip for now" is for — tags are never a gate before
            // a pin, and Skip is how that stays true.
            disabled={!tagsCanContinue(picked)}
            onPress={() => finish(true)}
          />
          {!tagsCanContinue(picked) ? (
            <View style={{ marginTop: spacing.sm }}>
              <Body muted>{TAGS_NEED_MORE(picked.length)}</Body>
            </View>
          ) : null}
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <Button kind="quiet" label="Skip for now" onPress={() => finish(false)} />
        </View>
      </AppScreen>
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
