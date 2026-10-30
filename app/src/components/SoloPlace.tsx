// A29's place and time in a 1-on-1 chat (UI pass 1, 079; Alex, 30 Oct 2026, decision 1 and
// call c): one optional row. Either of you can set it; nobody confirms. The place is one of
// this venue's curated spots or the event itself, never typed (H5); the time is words.
// Setting a place shows each other's Instagram handles (share_crew); taking it away hides
// them again. set_solo_place is the rule.
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors as palette, fonts, ONE_ON_ONE_COPY, radius, spacing } from "@pind/shared";
import { Button } from "./ui";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { Tap } from "./Tap";
import { failed } from "@/lib/errors";
import { setSoloPlace } from "@/lib/solo";

export function SoloPlace({
  crewId,
  spots,
  spotId,
  atEvent,
  timeNote,
  onChanged,
  open: openAs,
  onOpenChange,
  row = true,
}: {
  crewId: string;
  spots: { id: string; name: string }[];
  spotId: string | null;
  atEvent: boolean;
  timeNote: string | null;
  onChanged: () => void;
  // Opened from elsewhere too (the chat's header): the screen holds whether it is open.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Without its own row, when the screen draws the line itself.
  row?: boolean;
}) {
  const [openHere, setOpenHere] = useState(false);
  const open = openAs ?? openHere;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setOpenHere(o));
  const [place, setPlace] = useState<string | null>(spotId ?? (atEvent ? "event" : null));
  const [time, setTime] = useState(timeNote ?? "");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const shown = [spotId ? spots.find((s) => s.id === spotId)?.name : atEvent ? ONE_ON_ONE_COPY.atTheEvent : null, timeNote].filter(Boolean).join(" · ");

  const save = async () => {
    setBusy(true);
    setSaid(null);
    try {
      await setSoloPlace(crewId, place && place !== "event" ? place : null, place === "event", time);
      setOpen(false);
      onChanged();
    } catch (err) {
      setSaid(failed("save that", err).says);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {row ? (
        <Tap accessibilityRole="button" onPress={() => setOpen(true)} style={styles.row}>
          <Icon name="pin" size={16} color={palette.accentText} />
          <Text style={[styles.rowLabel, !shown && { color: palette.textMuted }]} numberOfLines={1}>{shown || ONE_ON_ONE_COPY.addPlace}</Text>
          <Text style={styles.plus}>{shown ? "›" : "+"}</Text>
        </Tap>
      ) : null}
      <Sheet visible={open} onClose={() => setOpen(false)}>
        <Text style={styles.title}>{ONE_ON_ONE_COPY.addPlace}</Text>
        <Text style={styles.label}>{ONE_ON_ONE_COPY.place}</Text>
        <View style={styles.chips}>
          {[...spots.map((s) => ({ key: s.id, name: s.name })), { key: "event", name: ONE_ON_ONE_COPY.atTheEvent }].map((o) => {
            const on = place === o.key;
            return (
              <Tap key={o.key} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setPlace(on ? null : o.key)} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipLabel, on && { color: palette.onAccent }]}>{o.name}</Text>
              </Tap>
            );
          })}
        </View>
        <Text style={styles.label}>{ONE_ON_ONE_COPY.time}</Text>
        <TextInput value={time} onChangeText={setTime} maxLength={40} placeholder={ONE_ON_ONE_COPY.timePlaceholder} placeholderTextColor={palette.tabInactive} style={styles.input} />
        {said ? <Text accessibilityRole="alert" style={styles.refusal}>{said}</Text> : null}
        <Button label={ONE_ON_ONE_COPY.save} busy={busy} onPress={() => void save()} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  // One slim line under the chat's header (UI pass 1, round 2: the chat leads).
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, borderBottomWidth: 1, borderBottomColor: palette.border },
  rowLabel: { flex: 1, fontSize: 15, color: palette.text },
  plus: { fontSize: 20, color: palette.textMuted },
  title: { fontFamily: fonts.headline, fontSize: 20, color: palette.text },
  label: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipLabel: { fontSize: 14, color: palette.text },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 16, color: palette.text, backgroundColor: palette.background },
  refusal: { fontSize: 14, color: "#F3B4B4" },
});
