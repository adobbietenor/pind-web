// Profile → Edit tags (A21, M3.1).
//
// **The same picker as A3**, with what you already have selected — because an edit
// screen that looks different from the one that asked in the first place makes people
// wonder whether it does something different.
//
// Tags were pickable once, at onboarding, and then fixed forever, which nobody would
// have found until somebody wanted to change one (Alex, walking A3).
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors as palette, spacing, TAGS_MINIMUM } from "@pind/shared";
import { Brand } from "@/components/Brand";
import { TagPicker, enoughPicked, type Picked } from "@/components/TagPicker";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { oneLine, failed } from "@/lib/errors";
import { loadMe } from "@/lib/profile";
import { loadTags, saveTags } from "@/lib/tags";

export default function EditTags() {
  const router = useRouter();
  const [personId, setPersonId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const me = await loadMe().catch(() => null);
      if (!live || !me) return setPicked([]);
      setPersonId(me.id);
      setPicked(await loadTags(me.id).catch(() => []));
    })();
    return () => {
      live = false;
    };
  }, []);

  const save = async () => {
    if (!personId || !picked) return;
    setBusy(true);
    setError("");
    try {
      await saveTags(personId, picked);
      router.back();
    } catch (err) {
      setError(oneLine(failed("save your tags", err)));
      setBusy(false);
    }
  };

  if (!picked) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Brand />
        <Heading>Your tags</Heading>
        <View style={{ marginBottom: spacing.md }}>
          <Body muted>
            Conversation starters, not a filter. Pick at least {TAGS_MINIMUM} — and choose which three people see beside your
            name.
          </Body>
        </View>

        {error ? <Notice tone="stop">{error}</Notice> : null}
        {note ? <Notice>{note}</Notice> : null}

        <TagPicker picked={picked} onChange={setPicked} onSay={setNote} />

        <View style={{ marginTop: spacing.lg }}>
          <Button label="Save" busy={busy} disabled={picked.length > 0 && !enoughPicked(picked)} onPress={save} />
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
});
