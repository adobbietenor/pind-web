// "Where": the neighbourhood and a few tags, drawn by A3 (the store path) and A27 (the
// link path) alike (M3.2).
//
// **Two pages since UI pass 1** (Alex, 30 Oct 2026; docs/design/ui-pass-1, 027/028): page 1
// is the neighbourhood alone, one choice, Next once one is picked; page 2 is the tags, with
// "Pick at least 3, up to 10." and a live count, Next at three. The rules underneath are
// unchanged: `tagsCanContinue` decides Next, and the eleventh tap is refused with a
// sentence by `toggleTag` (T03).
//
// **The database caps tags at ten and asks for none; this step asks for at least three**
// (V19). "At least three" is what a complete profile means, and a minimum in the database
// would make a pin impossible on the link path. So the counter is a request, and the cap
// underneath is a rule.
//
// **Skip is a real button, on both paths** (Alex, M3.2: "a thinner profile is better than
// no profile"). It stays on both pages: on the first it skips the step, on the second
// the tags. What is skipped is never forgotten: Profile names what is still missing, with
// a way to each (profileGaps, shared).
//
// **Tags are conversation handles, not match criteria** (spec A3): nothing sorts anyone.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, spacing, TAGS_MAXIMUM, TAGS_MINIMUM, TAGS_NEED_MORE } from "@pind/shared";
import { NeighbourhoodPicker } from "@/components/profile/NeighbourhoodPicker";
import { TagPicker, tagsCanContinue, type Picked } from "@/components/TagPicker";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { saveNeighbourhood } from "@/lib/profile";
import { saveTags } from "@/lib/tags";

export interface WhereStepProps {
  personId: string;
  neighbourhood: string | null;
  tags: Picked[];
  onDone: (saved: boolean) => void;
}

export function WhereStep({ personId, neighbourhood, tags, onDone }: WhereStepProps) {
  const [page, setPage] = useState<"where" | "tags">("where");
  const [hood, setHood] = useState<string | null>(neighbourhood);
  const [picked, setPicked] = useState<Picked[]>(tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Described | null>(null);

  // Each page saves what it holds, so a neighbourhood picked on page 1 is kept whatever
  // happens on page 2.
  const run = async (what: string, work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(failed(what, err));
    } finally {
      setBusy(false);
    }
  };
  const saveHood = () => (hood !== neighbourhood ? saveNeighbourhood(personId, hood) : Promise.resolve());

  const next = () => run("save your neighbourhood", async () => {
    await saveHood();
    setPage("tags");
  });
  const skipWhere = () => run("save your neighbourhood", async () => {
    await saveHood();
    onDone(false);
  });
  const save = () => run("save that", async () => {
    await saveTags(personId, picked);
    onDone(true);
  });

  if (page === "where") {
    return (
      <>
        <Heading>Where in the city?</Heading>
        <View style={{ marginBottom: spacing.lg }}>
          <Body muted>Pin&#39;d never asks where you are. Pick the part of town you&#39;d say you&#39;re from.</Body>
        </View>
        <NeighbourhoodPicker value={hood} onChange={setHood} />
        <View style={{ marginTop: spacing.lg }}>
          {error ? <Trouble what={error} onRetry={next} busy={busy} /> : null}
          <Button label="Next" busy={busy} disabled={!hood} onPress={next} />
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <Button kind="quiet" label="Skip for now" busy={busy} onPress={skipWhere} />
        </View>
      </>
    );
  }

  return (
    <>
      <Heading>A few things to say</Heading>
      <Body muted>Pick a few conversation starters just for fun.</Body>
      <View style={styles.countRow}>
        <Text style={styles.rule}>
          Pick at least {TAGS_MINIMUM}, up to {TAGS_MAXIMUM}.
        </Text>
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {picked.length} of {TAGS_MAXIMUM}
        </Text>
      </View>
      <TagPicker picked={picked} onChange={setPicked} showCount={false} />

      <View style={{ marginTop: spacing.lg }}>
        {error ? <Trouble what={error} onRetry={save} busy={busy} /> : null}
        <Button label="Next" busy={busy} disabled={!tagsCanContinue(picked)} onPress={save} />
        {!tagsCanContinue(picked) ? (
          <View style={{ marginTop: spacing.sm }}>
            <Body muted>{TAGS_NEED_MORE(picked.length)}</Body>
          </View>
        ) : null}
      </View>
      <View style={{ marginTop: spacing.sm }}>
        {/* Skip leaves the tags; the neighbourhood was saved on page 1. */}
        <Button kind="quiet" label="Skip for now" busy={busy} onPress={() => onDone(false)} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  countRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: spacing.xs, marginBottom: spacing.md },
  rule: { fontFamily: fonts.headline, fontSize: 15, color: palette.text },
  count: { fontSize: 15, color: palette.textTint },
});
