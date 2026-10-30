// Tapping a person anywhere opens this sheet (UI pass 1, 075): their photo, first name,
// area and conversation starters, and "Say hi in the room". It shows exactly what the row
// that was tapped already holds, read through RLS by the screen that drew the row, so it
// adds no visibility (H3, H11).
//
// "Let's meet up 1-on-1" (076) shows only for someone the database lets you ask
// (solo_people: can_see_solo), and becomes "Request sent ✓" once you have.
//
// **Never a missing button with no reason** (UI pass 1, round 2). Alex opened Tati's sheet
// and there was simply no button: her switch was off, and nothing said so. Now the place
// where the button goes always holds something: the button, or one line saying why not
// (oneOnOneState, shared and tested), with the switch itself when the reason is yours.
// `useOneOnOne` is the one way a screen fills it, so the room and the crowd page agree.
//
// Report and Block wait on A24, as on A22 (A24_EXISTS there); until then the sheet links to
// the full profile, where A24's ⋯ will be.
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ImageSource } from "expo-image";
import { colors as palette, fonts, ONE_ON_ONE_COPY, oneOnOneLine, oneOnOneState, radius, spacing, type OneOnOneState } from "@pind/shared";
import { failed } from "@/lib/errors";
import { inviteSolo, soloFacts, type SoloFacts } from "@/lib/solo";
import { Avatar } from "./Avatar";
import { OneOnOneSwitch } from "./OneOnOneSwitch";
import { SheetFrame } from "./Sheet";
import { Tap } from "./Tap";

export interface SheetPerson {
  id: string;
  firstName: string;
  photo: ImageSource | string | null | undefined;
  area: string | null;
  tags: string[];
}

export interface SheetOneOnOne {
  state: OneOnOneState;
  busy: boolean;
  refusal: string | null;
  onAsk: () => void;
  // The switch was turned on or off in the sheet: read everything again.
  onSwitched: () => void;
}

// The 1-on-1 facts at one gathering, and the sheet's part for any person there.
export function useOneOnOne(gathering: { id: string; startsAt: string } | null, meId: string | null) {
  const [facts, setFacts] = useState<SoloFacts | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const id = gathering?.id ?? null;
  const read = useCallback(() => {
    if (!id || !meId) return setFacts(null);
    soloFacts(id, meId).then(setFacts, () => setFacts(null));
  }, [id, meId]);
  useEffect(read, [read]);

  const forPerson = (personId: string): SheetOneOnOne | null => {
    if (!gathering || !facts) return null;
    return {
      state: oneOnOneState({
        atGathering: true,
        available: facts.available,
        asked: facts.asked.includes(personId),
        started: Date.now() >= Date.parse(gathering.startsAt),
        inPlan: facts.inPlan,
        mineOn: facts.mineOn,
        open: facts.open.includes(personId),
      }),
      busy,
      refusal,
      onAsk: async () => {
        setBusy(true);
        setRefusal(null);
        try {
          await inviteSolo(gathering.id, personId);
          read();
        } catch (err) {
          setRefusal(failed("send that", err).says);
        } finally {
          setBusy(false);
        }
      },
      onSwitched: read,
    };
  };
  return { facts, read, forPerson, clearRefusal: () => setRefusal(null) };
}

export function PersonSheet({
  person,
  onClose,
  onSayHi,
  onProfile,
  oneOnOne,
}: {
  person: SheetPerson | null;
  onClose: () => void;
  onSayHi?: () => void;
  onProfile: () => void;
  // Null only while it is being read; once read, always a button or a reason.
  oneOnOne: SheetOneOnOne | null;
}) {
  const line = person && oneOnOne ? oneOnOneLine(oneOnOne.state, person.firstName) : null;
  return (
    <SheetFrame visible={!!person} onClose={onClose} contentStyle={{ alignItems: "center", gap: spacing.sm }}>
      {person ? (
        <>
          <Avatar name={person.firstName} source={person.photo} size={112} />
          <Text style={styles.name}>{person.firstName}</Text>
          {person.area ? <Text style={styles.area}>{person.area}</Text> : null}
          {person.tags.length ? (
            <View style={styles.tags}>
              {person.tags.map((t) => (
                <View key={t} style={styles.tag}>
                  <Text style={styles.tagLabel}>{t}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.sm }}>
            {oneOnOne?.state === "ask" ? (
              <Tap accessibilityRole="button" disabled={oneOnOne.busy} onPress={oneOnOne.onAsk} style={styles.primary}>
                <Text style={styles.primaryLabel}>{ONE_ON_ONE_COPY.ask}</Text>
              </Tap>
            ) : line ? (
              <Text style={oneOnOne?.state === "asked" ? styles.sent : styles.why}>{line}</Text>
            ) : null}
            {/* The reason is yours: the switch is right here, not somewhere in Settings. */}
            {oneOnOne?.state === "turnOn" ? <OneOnOneSwitch onChanged={oneOnOne.onSwitched} /> : null}
            {oneOnOne?.refusal ? <Text accessibilityRole="alert" style={styles.refusal}>{oneOnOne.refusal}</Text> : null}
            {onSayHi ? (
              <Tap accessibilityRole="button" onPress={onSayHi} style={oneOnOne?.state === "ask" ? styles.quiet : styles.primary}>
                <Text style={oneOnOne?.state === "ask" ? styles.quietLabel : styles.primaryLabel}>Say hi in the room</Text>
              </Tap>
            ) : null}
            <Tap accessibilityRole="button" onPress={onProfile} style={styles.quiet}>
              <Text style={styles.quietLabel}>See their profile</Text>
            </Tap>
          </View>
        </>
      ) : null}
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: fonts.headline, fontSize: 24, color: palette.text, marginTop: spacing.xs },
  area: { fontSize: 15, color: palette.textMuted },
  tags: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xs },
  tag: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  tagLabel: { fontSize: 14, color: palette.text },
  primary: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: palette.accent },
  primaryLabel: { fontFamily: fonts.headline, fontSize: 16, color: palette.onAccent },
  quiet: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: palette.border },
  quietLabel: { fontFamily: fonts.headline, fontSize: 15, color: palette.text },
  sent: { fontSize: 15, lineHeight: 21, color: palette.accentText, textAlign: "center", paddingVertical: spacing.sm },
  why: { fontSize: 15, lineHeight: 21, color: palette.textMuted, textAlign: "center", paddingVertical: spacing.sm },
  refusal: { fontSize: 14, color: "#F3B4B4", textAlign: "center" },
});
