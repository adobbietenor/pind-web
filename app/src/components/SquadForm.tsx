// A15 / A11 — the squad form, to start one and for any member to change it (UI pass 1,
// 064/065; Alex, 30 Oct 2026, calls 1 and f). A name, and optional details, place and
// time, each removable.
//
// **The place is never typed (H5 stands).** "Add a place" opens this venue's curated spots
// and "At the event itself"; the database refuses anything else (check_squad_place). The
// time is words. The words are checked before anyone else sees them (squad_card_text), and
// handles, links and numbers are refused outright (squad_contact): the sentence for each
// refusal is squadRefusal's, said under the button that was pressed.
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors as palette, fonts, radius, spacing, SQUAD_COPY, SQUAD_DETAILS_MAX, SQUAD_FORM_COPY, SQUAD_NAME_MAX, SQUAD_TIME_MAX, squadNameProblem } from "@pind/shared";
import { Button } from "./ui";
import { Icon } from "./Icon";
import { SheetFrame } from "./Sheet";
import { Tap } from "./Tap";

export interface SquadWords {
  name: string;
  details: string;
  // null: no place set; "event": at the event itself; otherwise a curated spot's id.
  place: string | null;
  time: string;
}

export function SquadForm({
  title,
  start,
  spots,
  womenOnly,
  busy,
  refusal,
  onClose,
  onSave,
}: {
  title: string;
  start?: SquadWords;
  spots: { id: string; name: string }[];
  // Starting only: whether "Who can join" is offered, and whether it is forced.
  womenOnly?: { eligible: boolean; only: boolean };
  busy: boolean;
  refusal: string | null;
  onClose: () => void;
  onSave: (w: SquadWords, forWomen: boolean) => void;
}) {
  const [name, setName] = useState(start?.name ?? "");
  const [details, setDetails] = useState(start?.details ?? "");
  const [place, setPlace] = useState<string | null>(start?.place ?? null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [time, setTime] = useState(start?.time ?? "");
  const [timeOpen, setTimeOpen] = useState(!!start?.time);
  const [forWomen, setForWomen] = useState(womenOnly?.only ?? false);
  const problem = squadNameProblem(name);
  const placeName = place === "event" ? SQUAD_FORM_COPY.atTheEvent : spots.find((s) => s.id === place)?.name ?? null;

  return (
    // The shared sheet: it stands on the keyboard and keeps the field being typed in, and
    // the button under it, in view (UI pass 1, round 2: the fields were covered on the phone).
    <SheetFrame visible onClose={onClose} animation="slide" style={styles.sheet} contentStyle={{ gap: spacing.sm }}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{title}</Text>
              <Tap accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
                <Text style={styles.closeX}>×</Text>
              </Tap>
            </View>
            <Text style={styles.line}>{SQUAD_FORM_COPY.line}</Text>

            <Text style={styles.label}>{SQUAD_FORM_COPY.name}</Text>
            <TextInput value={name} onChangeText={setName} maxLength={SQUAD_NAME_MAX + 10} placeholder={SQUAD_FORM_COPY.namePlaceholder} placeholderTextColor={palette.tabInactive} style={styles.input} autoFocus={!start} />
            {name && problem ? <Text style={styles.meta}>{problem}</Text> : null}

            <Text style={styles.label}>
              {SQUAD_FORM_COPY.details} <Text style={styles.optional}>{SQUAD_FORM_COPY.optional}</Text>
            </Text>
            <TextInput value={details} onChangeText={setDetails} maxLength={SQUAD_DETAILS_MAX} multiline placeholder={SQUAD_FORM_COPY.detailsPlaceholder} placeholderTextColor={palette.tabInactive} style={[styles.input, styles.multi]} />

            <Text style={styles.label}>
              {SQUAD_FORM_COPY.meetingPoint} <Text style={styles.optional}>{SQUAD_FORM_COPY.optional}</Text>
            </Text>
            {placeName ? (
              <Row icon="pin" text={placeName} onRemove={() => setPlace(null)} />
            ) : placeOpen ? (
              <View style={styles.chips}>
                {[...spots.map((s) => ({ key: s.id, name: s.name })), { key: "event", name: SQUAD_FORM_COPY.atTheEvent }].map((o) => (
                  <Tap key={o.key} accessibilityRole="radio" onPress={() => { setPlace(o.key); setPlaceOpen(false); }} style={styles.chip}>
                    <Text style={styles.chipLabel}>{o.name}</Text>
                  </Tap>
                ))}
              </View>
            ) : (
              <Add icon="pin" text={SQUAD_FORM_COPY.addPlace} onPress={() => setPlaceOpen(true)} />
            )}
            {timeOpen ? (
              <View style={styles.timeRow}>
                <Icon name="clock" size={18} color={palette.accentText} />
                <TextInput value={time} onChangeText={setTime} maxLength={SQUAD_TIME_MAX} placeholder={SQUAD_FORM_COPY.timePlaceholder} placeholderTextColor={palette.tabInactive} style={styles.timeInput} />
                <Tap accessibilityRole="button" accessibilityLabel={`${SQUAD_FORM_COPY.remove} the time`} onPress={() => { setTime(""); setTimeOpen(false); }} style={styles.remove}>
                  <Text style={styles.closeX}>×</Text>
                </Tap>
              </View>
            ) : (
              <Add icon="clock" text={SQUAD_FORM_COPY.addTime} onPress={() => setTimeOpen(true)} />
            )}

            {womenOnly?.eligible ? (
              <>
                <Text style={styles.label}>{SQUAD_COPY.who}</Text>
                {womenOnly.only ? (
                  <Text style={styles.meta}>{SQUAD_COPY.womenOnlyForced}</Text>
                ) : (
                  <View style={styles.chips}>
                    {[
                      { key: false, name: SQUAD_COPY.whoEveryone },
                      { key: true, name: SQUAD_COPY.whoWomenOnly },
                    ].map((o) => (
                      <Tap key={String(o.key)} accessibilityRole="radio" accessibilityState={{ selected: forWomen === o.key }} onPress={() => setForWomen(o.key)} style={[styles.chip, forWomen === o.key && styles.chipOn]}>
                        <Text style={[styles.chipLabel, forWomen === o.key && { color: palette.onAccent }]}>{o.name}</Text>
                      </Tap>
                    ))}
                  </View>
                )}
              </>
            ) : null}

            <View style={{ marginTop: spacing.sm }}>
              <Button label={start ? SQUAD_FORM_COPY.save : SQUAD_FORM_COPY.start} disabled={!!problem} busy={busy} onPress={() => onSave({ name: name.trim(), details: details.trim(), place, time: time.trim() }, forWomen)} />
            </View>
            {refusal ? <Text accessibilityRole="alert" style={styles.refusal}>{refusal}</Text> : null}
    </SheetFrame>
  );
}

function Add({ icon, text, onPress }: { icon: "pin" | "clock"; text: string; onPress: () => void }) {
  return (
    <Tap accessibilityRole="button" onPress={onPress} style={styles.add}>
      <Icon name={icon} size={18} color={palette.text} />
      <Text style={styles.addLabel}>{text}</Text>
    </Tap>
  );
}

function Row({ icon, text, onRemove }: { icon: "pin"; text: string; onRemove: () => void }) {
  return (
    <View style={styles.set}>
      <Icon name={icon} size={18} color={palette.accentText} />
      <Text style={styles.setLabel}>{text}</Text>
      <Tap accessibilityRole="button" accessibilityLabel={`${SQUAD_FORM_COPY.remove} ${text}`} onPress={onRemove} style={styles.remove}>
        <Text style={styles.closeX}>×</Text>
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.headline, fontSize: 26, color: palette.text },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeX: { fontSize: 24, color: palette.text, lineHeight: 26 },
  line: { fontSize: 15, color: palette.textMuted, marginBottom: spacing.xs },
  label: { fontFamily: fonts.headline, fontSize: 15, color: palette.text, marginTop: spacing.sm },
  optional: { fontFamily: undefined, color: palette.textMuted },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 16, color: palette.text, backgroundColor: palette.surface },
  multi: { minHeight: 90, paddingTop: 12, textAlignVertical: "top" },
  meta: { fontSize: 13, color: palette.textMuted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipLabel: { fontSize: 14, color: palette.text },
  add: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: palette.border },
  addLabel: { fontFamily: fonts.headline, fontSize: 15, color: palette.text },
  set: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, paddingLeft: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  setLabel: { flex: 1, fontSize: 16, color: palette.text },
  timeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, paddingLeft: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  // No browser focus ring inside the row: the row is the field (web).
  timeInput: { flex: 1, minHeight: 48, fontSize: 16, color: palette.text, ...({ outlineStyle: "none" } as object) },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  refusal: { fontSize: 14, color: "#E06B6B" },
});
