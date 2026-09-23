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
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors as palette, spacing, TAGS_MINIMUM, TAGS_NEED_MORE } from "@pind/shared";
import { TagPicker, tagsCanContinue, type Picked } from "@/components/TagPicker";
import { AppScreen } from "@/components/AppScreen";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { oneLine, failed } from "@/lib/errors";
import { loadMe } from "@/lib/profile";
import { loadTags, saveTags } from "@/lib/tags";

export default function EditTags() {
  const router = useRouter();
  const [personId, setPersonId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[] | null>(null);
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
      <AppScreen edges={["top", "bottom"]} scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  return (
    <AppScreen edges={["top", "bottom"]}>
        <Heading>Your tags</Heading>
        <View style={{ marginBottom: spacing.md }}>
          <Body muted>
            Conversation starters, not a filter. Pick at least {TAGS_MINIMUM} — and choose which three people see beside your
            name.
          </Body>
        </View>

        {error ? <Notice tone="stop">{error}</Notice> : null}
        <TagPicker picked={picked} onChange={setPicked} />

        <View style={{ marginTop: spacing.lg }}>
          {/* The shared rule, and only the shared rule (T10). */}
          <Button label="Save" busy={busy} disabled={!tagsCanContinue(picked)} onPress={save} />
          {!tagsCanContinue(picked) ? (
            <View style={{ marginTop: spacing.sm }}>
              <Body muted>{TAGS_NEED_MORE(picked.length, false)}</Body>
            </View>
          ) : null}
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
        </View>
      </AppScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
});
