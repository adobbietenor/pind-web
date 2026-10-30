// A9 on the night (UI pass 1, 088): the one "I'm here" switch, for the room and your squad.
// Switching it on asks for Q7's line first (never geofenced, never blank); nothing is sent
// until "Tell them". The refusal is said under the field that was used.
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors as palette, HERE_COPY, radius, spacing } from "@pind/shared";
import { Button } from "./ui";
import { SwitchRow } from "./SwitchRow";
import { clearHere, HereRefused, setHere } from "@/lib/here";
import { failed } from "@/lib/errors";

export function ImHere({
  gatheringId,
  note,
  people,
  onChanged,
}: {
  gatheringId: string;
  note: string | null;
  // Who else is here, with their lines: only what here_now let this person see.
  people: { personId: string; firstName: string; note: string }[];
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setSaid(null);
    try {
      await work();
      setAsking(false);
      setDraft("");
      onChanged();
    } catch (err) {
      setSaid(err instanceof HereRefused ? HERE_COPY.refusal(err.hint) : failed("change that", err).says);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <SwitchRow
        icon="pin"
        label={HERE_COPY.label}
        line={note ? HERE_COPY.yours(note) : HERE_COPY.line}
        value={!!note || asking}
        disabled={busy}
        onChange={(on) => (on ? setAsking(true) : note ? void run(() => clearHere(gatheringId)) : setAsking(false))}
      />
      {asking && !note ? (
        <View style={styles.ask}>
          <Text style={styles.label}>{HERE_COPY.ask}</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={HERE_COPY.placeholder}
            placeholderTextColor={palette.tabInactive}
            maxLength={80}
            autoFocus
            style={styles.input}
          />
          {said ? <Text accessibilityRole="alert" style={styles.refusal}>{said}</Text> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label={HERE_COPY.save} busy={busy} disabled={!draft.trim()} onPress={() => void run(() => setHere(gatheringId, draft))} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="quiet" label={HERE_COPY.cancel} onPress={() => setAsking(false)} />
            </View>
          </View>
        </View>
      ) : null}
      {said && !asking ? <Text accessibilityRole="alert" style={styles.refusal}>{said}</Text> : null}
      {people.map((p) => (
        <Text key={p.personId} style={styles.other}>{HERE_COPY.theirs(p.firstName, p.note)}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ask: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  label: { fontSize: 14, color: palette.textMuted },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 16, color: palette.text, backgroundColor: palette.background },
  refusal: { fontSize: 14, color: "#F3B4B4" },
  other: { fontSize: 14, color: palette.textMuted, paddingHorizontal: spacing.xs },
});
