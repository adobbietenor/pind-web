// "Where" — the neighbourhood and a few tags. ONE step, drawn by A3 (the store path)
// and A27 (the link path) alike (M3.2).
//
// **The database caps tags at ten and asks for none; this step asks for at least three**
// (V19). "At least three" is what a complete profile means, and a minimum in the database
// would make a pin impossible on the link path. So the counter is a request, and the cap
// underneath is a rule.
//
// **Skip is a real button, on both paths** (Alex, M3.2: "a thinner profile is better than
// no profile"). What is skipped is never forgotten: Profile names what is still missing,
// with a way to each (profileGaps, shared).
//
// **Tags are conversation handles, not match criteria** (spec A3): nothing sorts anyone.
import { useState } from "react";
import { View } from "react-native";
import { spacing, TAGS_MINIMUM, TAGS_NEED_MORE } from "@pind/shared";
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
  const [hood, setHood] = useState<string | null>(neighbourhood);
  const [picked, setPicked] = useState<Picked[]>(tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Described | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (hood !== neighbourhood) await saveNeighbourhood(personId, hood);
      await saveTags(personId, picked);
      onDone(true);
    } catch (err) {
      setError(failed("save that", err));
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (hood === neighbourhood) return onDone(false);
    setBusy(true);
    setError(null);
    try {
      await saveNeighbourhood(personId, hood);
      onDone(false);
    } catch (err) {
      setError(failed("save your neighbourhood", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Heading>Where in the city?</Heading>
      <View style={{ marginBottom: spacing.lg }}>
        <Body muted>Pin&#39;d never asks where you are. Pick the part of town you would say you are from — it gives a crew something to start with.</Body>
      </View>
      <NeighbourhoodPicker value={hood} onChange={setHood} />

      <View style={{ marginTop: spacing.xl }}>
        <Heading>A few things to say</Heading>
      </View>
      <View style={{ marginBottom: spacing.md }}>
        <Body muted>Conversation starters, not a filter — nothing here sorts anyone. Pick at least {TAGS_MINIMUM}.</Body>
      </View>
      <TagPicker picked={picked} onChange={setPicked} />

      <View style={{ marginTop: spacing.lg }}>
        {error ? <Trouble what={error} onRetry={save} busy={busy} /> : null}
        <Button
          label="Continue"
          busy={busy}
          // The shared rule, and only the shared rule (T10): three to ten. Leaving with
          // fewer is what Skip is for.
          disabled={!tagsCanContinue(picked)}
          onPress={save}
        />
        {!tagsCanContinue(picked) ? (
          <View style={{ marginTop: spacing.sm }}>
            <Body muted>{TAGS_NEED_MORE(picked.length)}</Body>
          </View>
        ) : null}
      </View>
      <View style={{ marginTop: spacing.sm }}>
        {/* Skip leaves the tags; a neighbourhood already chosen is kept rather than
            thrown away — a skip should never make the profile thinner than it chose. */}
        <Button kind="quiet" label="Skip for now" busy={busy} onPress={skip} />
      </View>
    </>
  );
}
