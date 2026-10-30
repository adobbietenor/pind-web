// A9 on the night (UI pass 1, 088): the one "I've arrived" switch, for the room and your
// squad. Switching it on asks for Q7's line first (never geofenced, never blank); nothing is
// sent until "Tell them". The refusal is said under the field that was used.
//
// Two shapes since round 2, one switch underneath (set_here, clear_here):
//   * the crowd page's: the switch, Q7's description and "N have arrived" with the row;
//   * `slim`, the squad's: one row that leads to the chat rather than above it, with "Later"
//     to put it away for that squad (onLater). The switch and its description live on the
//     crowd page.
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors as palette, HERE_COPY, radius, spacing } from "@pind/shared";
import { Button } from "./ui";
import { Icon } from "./Icon";
import { SwitchRow } from "./SwitchRow";
import { Tap } from "./Tap";
import { clearHere, HereRefused, setHere } from "@/lib/here";
import { failed } from "@/lib/errors";

export function ImHere({
  gatheringId,
  note,
  people,
  count,
  onChanged,
  slim = false,
  onLater,
}: {
  gatheringId: string;
  note: string | null;
  // Who else has arrived, with their lines: only what here_now let this person see.
  people: { personId: string; firstName: string; note: string }[];
  count: number;
  onChanged: () => void;
  slim?: boolean;
  onLater?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

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

  const ask =
    asking && !note ? (
      <View style={styles.ask}>
        <Text style={styles.label}>{HERE_COPY.ask}</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={HERE_COPY.placeholder}
          placeholderTextColor={palette.tabInactive}
          maxLength={80}
          autoFocus
          returnKeyType="send"
          onSubmitEditing={() => (draft.trim() ? void run(() => setHere(gatheringId, draft)) : undefined)}
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
    ) : null;
  const others = people.map((p) => (
    <Text key={p.personId} style={styles.other}>{HERE_COPY.theirs(p.firstName, p.note)}</Text>
  ));

  if (slim) {
    return (
      <View style={{ gap: spacing.xs }}>
        <View style={styles.slim}>
          <Tap
            accessibilityRole="button"
            onPress={() => (note ? setShowAll(!showAll) : (setAsking(true), setShowAll(true)))}
            style={styles.slimMain}
          >
            <Icon name="pin" size={16} color={palette.accentText} />
            <Text style={styles.slimLabel} numberOfLines={1}>
              {note ? HERE_COPY.yours(note) : HERE_COPY.label}
              {count > (note ? 1 : 0) ? <Text style={styles.slimCount}>{`  ·  ${HERE_COPY.count(count)}`}</Text> : null}
            </Text>
          </Tap>
          {!note && onLater ? (
            <Tap accessibilityRole="button" onPress={onLater} style={styles.later}>
              <Text style={styles.laterLabel}>{HERE_COPY.later}</Text>
            </Tap>
          ) : null}
        </View>
        {ask}
        {said && !asking ? <Text accessibilityRole="alert" style={styles.refusal}>{said}</Text> : null}
        {showAll ? others : null}
      </View>
    );
  }

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
      {/* Its own count, with its own row: at the venue, not in the room. */}
      <View style={styles.countRow}>
        <Icon name="pin" size={18} color={palette.accentText} />
        <Text style={styles.count}>{HERE_COPY.count(count)}</Text>
      </View>
      {ask}
      {said && !asking ? <Text accessibilityRole="alert" style={styles.refusal}>{said}</Text> : null}
      {others}
    </View>
  );
}

const styles = StyleSheet.create({
  ask: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  label: { fontSize: 14, color: palette.textMuted },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 16, color: palette.text, backgroundColor: palette.background },
  refusal: { fontSize: 14, color: "#F3B4B4" },
  other: { fontSize: 14, color: palette.textMuted, paddingHorizontal: spacing.xs },
  countRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs },
  count: { fontSize: 15, color: palette.text },
  slim: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border },
  slimMain: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  slimLabel: { flex: 1, fontSize: 15, color: palette.text },
  slimCount: { color: palette.textMuted },
  later: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  laterLabel: { fontSize: 15, color: palette.textMuted },
});
