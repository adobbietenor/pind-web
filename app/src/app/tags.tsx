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
import { colors as palette, Said, spacing, TAGS_MINIMUM, TAGS_NEED_MORE } from "@pind/shared";
import { TagPicker, tagsCanContinue, type Picked } from "@/components/TagPicker";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { oneLine, failed, type Described } from "@/lib/errors";
import { loadMe } from "@/lib/profile";
import { loadTags, saveTags } from "@/lib/tags";

export default function EditTags() {
  const router = useRouter();
  const [personId, setPersonId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadTrouble, setLoadTrouble] = useState<Described | null>(null);
  const [attempt, setAttempt] = useState(0);

  // **A load that failed is not "no tags"** (M3.1, airplane mode): it used to show an
  // empty picker, as if the person had none, with a Save that silently did nothing.
  useEffect(() => {
    let live = true;
    setLoadTrouble(null);
    (async () => {
      const me = await loadMe();
      if (!me) throw new Said("There is no profile on this account yet.");
      const tags = await loadTags(me.id);
      if (!live) return;
      setPersonId(me.id);
      setPicked(tags);
    })().catch((err) => live && setLoadTrouble(failed("load your tags", err)));
    return () => {
      live = false;
    };
  }, [attempt]);

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

  if (loadTrouble) {
    return (
      <AppScreen edges={["top", "bottom"]}>
        <Heading>Your tags</Heading>
        <Trouble what={loadTrouble} onRetry={() => setAttempt((n) => n + 1)} />
        <Button kind="quiet" label="Back to your profile" onPress={() => router.back()} />
      </AppScreen>
    );
  }

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
