// Tapping a person anywhere opens this sheet (UI pass 1, 075): their photo, first name,
// area and conversation starters, and "Say hi in the room". It shows exactly what the row
// that was tapped already holds, read through RLS by the screen that drew the row, so it
// adds no visibility (H3, H11).
//
// "Request to chat" (build 23) shows only for someone the database lets you ask
// (solo_people: can_see_solo), and becomes "Request sent" once you have. Someone you are
// already connected with gets "Message": your one chat with them.
//
// **Never a missing button with no reason** (UI pass 1, round 2). Alex opened Tati's sheet
// and there was simply no button: her switch was off, and nothing said so. Now the place
// where the button goes always holds something: the button, or one line saying why not
// (oneOnOneState, shared and tested), with the switch itself when the reason is yours.
// `useOneOnOne` is the one way a screen fills it, so the room and the crowd page agree.
//
// A24 (16 Nov 2026): "⋯" in the corner, report or block in two taps. iOS shows one modal at a
// time, so this sheet closes first and A24's opens after it.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ImageSource } from "expo-image";
import { colors as palette, effectiveEnd, fonts, ONE_ON_ONE_COPY, oneOnOneLine, oneOnOneState, radius, spacing, type OneOnOneState } from "@pind/shared";
import { failed } from "@/lib/errors";
import { inviteSolo, soloFacts, type SoloFacts } from "@/lib/solo";
import { Avatar } from "./Avatar";
import { MoreButton, ReportBlockSheet, type ReportTarget } from "./ReportBlock";
import { Platform } from "react-native";
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
  // "Turn on 1-on-1 chats" flips the viewer's switch for this event (round 3, item 10).
  gatheringId: string;
  state: OneOnOneState;
  busy: boolean;
  refusal: string | null;
  onAsk: () => void;
  // "Message": the pair's chat, for someone you are already connected with.
  chatId: string | null;
  // The switch was turned on or off in the sheet: read everything again.
  onSwitched: () => void;
}

// The 1-on-1 facts at one gathering, and the sheet's part for any person there.
export function useOneOnOne(gathering: { id: string; startsAt: string; endsAt?: string | null } | null, meId: string | null) {
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
      gatheringId: gathering.id,
      state: oneOnOneState({
        atGathering: true,
        available: facts.available,
        asked: facts.asked.includes(personId),
        // Requests run to the effective end (16 Nov 2026).
        ended: Date.now() >= Date.parse(effectiveEnd(gathering.startsAt, gathering.endsAt ?? null)),
        connected: !!facts.connected[personId],
        inPlan: facts.inPlan,
        mineOn: facts.mineOn,
        open: facts.open.includes(personId),
      }),
      chatId: facts.connected[personId] ?? null,
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
  const router = useRouter();
  const [a24, setA24] = useState<ReportTarget | null>(null);
  const line = person && oneOnOne ? oneOnOneLine(oneOnOne.state, person.firstName) : null;
  return (
    <>
    <ReportBlockSheet target={a24} onClose={() => setA24(null)} onDone={() => oneOnOne?.onSwitched()} />
    <SheetFrame visible={!!person} onClose={onClose} contentStyle={{ alignItems: "center", gap: spacing.sm }}>
      {person ? (
        <>
          <View style={styles.corner}>
            <MoreButton
              onPress={() => {
                const t: ReportTarget = { kind: "person", id: person.id, firstName: person.firstName };
                onClose();
                setTimeout(() => setA24(t), Platform.OS === "ios" ? 350 : 0);
              }}
            />
          </View>
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
            {oneOnOne?.state === "connected" && oneOnOne.chatId ? (
              <Tap
                accessibilityRole="button"
                onPress={() => {
                  const chat = oneOnOne.chatId!;
                  onClose();
                  router.push({ pathname: "/chat/[id]", params: { id: chat } });
                }}
                style={styles.primary}
              >
                <Text style={styles.primaryLabel}>{ONE_ON_ONE_COPY.message}</Text>
              </Tap>
            ) : oneOnOne?.state === "ask" ? (
              <Tap accessibilityRole="button" haptic="action" disabled={oneOnOne.busy} onPress={oneOnOne.onAsk} style={styles.primary}>
                <Text style={styles.primaryLabel}>{ONE_ON_ONE_COPY.ask}</Text>
              </Tap>
            ) : line ? (
              <Text style={oneOnOne?.state === "asked" ? styles.sent : styles.why}>{line}</Text>
            ) : null}
            {/* The reason is yours: the switch is right here, not somewhere in Settings. */}
            {oneOnOne?.state === "turnOn" ? <OneOnOneSwitch gatheringId={oneOnOne.gatheringId} onChanged={oneOnOne.onSwitched} /> : null}
            {oneOnOne?.refusal ? <Text accessibilityRole="alert" style={styles.refusal}>{oneOnOne.refusal}</Text> : null}
            {onSayHi ? (
              <Tap accessibilityRole="button" onPress={onSayHi} style={oneOnOne?.state === "ask" ? styles.quiet : styles.primary}>
                <Text style={oneOnOne?.state === "ask" ? styles.quietLabel : styles.primaryLabel}>Say hi in the room</Text>
              </Tap>
            ) : null}
            <Tap accessibilityRole="button" onPress={onProfile} style={styles.quiet}>
              <Text style={styles.quietLabel}>{ONE_ON_ONE_COPY.seeProfile}</Text>
            </Tap>
          </View>
        </>
      ) : null}
    </SheetFrame>
    </>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: fonts.headline, fontSize: 24, color: palette.text, marginTop: spacing.xs },
  corner: { position: "absolute", top: 0, right: 0 },
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
