// A9 — 1-on-1 at this event (build 23; Alex, 16 Nov 2026). One question, as soon as you've
// pinned in: "Open to meeting people 1-on-1 at this event?", with a switch.
//
//   * not open to meeting yet: turning it on takes you through that first (A27 if you have no
//     profile) and lands you back here with it on — the screen's onTurnOnFirst does it;
//   * on: your requests here, then your 1-on-1 here if you have one (its chat one tap away),
//     else "Open to 1-on-1 here": everyone else at this event the database lets you see for
//     1-on-1 (solo_people: can_see_solo) — photo, first name, area. Tap one for their sheet;
//   * off: one line, "Turn this on to see who's open to 1-on-1". Reciprocal (H3): with it off
//     solo_people returns nobody, so there is nobody to draw.
//
// Nothing here decides who is listed: it draws the faces the crowd page read through RLS
// that solo_people also returned (H11). No step asks for a place or a time.
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, ONE_ON_ONE_COPY, radius, spacing } from "@pind/shared";
import { Avatar } from "./Avatar";
import { OneOnOneSwitch } from "./OneOnOneSwitch";
import { RequestCard } from "./RequestCard";
import { SwitchRow } from "./SwitchRow";
import { Tap } from "./Tap";
import { Body, Button } from "./ui";
import { connectionWith } from "@/lib/connections";
import { failed } from "@/lib/errors";
import { MY_CHATS_KEY } from "@/lib/myevents";
import { queryClient } from "@/lib/query";
import { loadRequests, REQUESTS_KEY } from "@/lib/requests";
import { answerSolo, type SoloFacts } from "@/lib/solo";

export interface HereFace {
  id: string;
  firstName: string;
  photoUrl: string | null;
  area: string | null;
}

export function OneOnOneHere({
  gatheringId,
  openToMeeting,
  facts,
  faces,
  busy,
  onTurnOnFirst,
  onChanged,
  onPerson,
}: {
  gatheringId: string;
  // Open to meeting at this event: the switch itself is the database's (set_event_one_on_one
  // refuses it otherwise), so before that the screen walks you there first.
  openToMeeting: boolean;
  facts: SoloFacts | null;
  faces: HereFace[];
  busy: boolean;
  onTurnOnFirst: () => void;
  onChanged: () => void;
  onPerson: (face: HereFace) => void;
}) {
  const router = useRouter();
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: loadRequests, staleTime: 5_000 });
  const [answering, setAnswering] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ id: string; says: string } | null>(null);
  const here = (requests.data?.solo ?? []).filter((r) => r.gatheringId === gatheringId);
  const on = openToMeeting && !!facts?.mineOn;
  const open = faces.filter((f) => facts?.open.includes(f.id));

  const answer = async (proposalId: string, personId: string, accept: boolean) => {
    setAnswering(proposalId);
    setRefusal(null);
    try {
      await answerSolo(proposalId, accept);
      void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_CHATS_KEY });
      onChanged();
      if (accept) {
        // Accept opens the chat: the pair's one chat, made by the yes.
        const chat = await connectionWith(personId);
        if (chat) router.push({ pathname: "/chat/[id]", params: { id: chat } });
      }
    } catch (err) {
      setRefusal({ id: proposalId, says: failed("answer that", err).says });
    } finally {
      setAnswering(null);
    }
  };

  return (
    <View style={styles.card}>
      {openToMeeting ? (
        <OneOnOneSwitch key={String(facts?.mineOn)} gatheringId={gatheringId} onChanged={onChanged} />
      ) : (
        <SwitchRow icon="handshake" label={ONE_ON_ONE_COPY.switchLabel} line={ONE_ON_ONE_COPY.switchLine} value={false} disabled={busy} onChange={(v) => v && onTurnOnFirst()} />
      )}

      {on && here.length ? (
        <View>
          <Text style={styles.heading}>{ONE_ON_ONE_COPY.requestsHere}</Text>
          {here.map((r) => (
            <RequestCard
              key={r.proposalId}
              name={r.firstName}
              photoPath={r.photoPath}
              title={ONE_ON_ONE_COPY.wantsToMeet(r.firstName)}
              line={ONE_ON_ONE_COPY.at(r.gatheringName)}
              busy={answering === r.proposalId}
              refusal={refusal?.id === r.proposalId ? refusal.says : null}
              onAccept={() => void answer(r.proposalId, r.personId, true)}
              onNotNow={() => void answer(r.proposalId, r.personId, false)}
            />
          ))}
        </View>
      ) : null}

      {!on ? (
        <Text style={styles.off}>{ONE_ON_ONE_COPY.offLine}</Text>
      ) : facts?.plan ? (
        <View style={{ gap: spacing.sm }}>
          <Body>{ONE_ON_ONE_COPY.youHaveOne(facts.plan.firstName)}</Body>
          {facts.plan.connectionId ? (
            <Button label={ONE_ON_ONE_COPY.openChat} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: facts.plan!.connectionId! } })} />
          ) : null}
        </View>
      ) : (
        <View>
          <Text style={styles.heading}>{ONE_ON_ONE_COPY.sectionHeading}</Text>
          {open.length === 0 ? (
            <Body muted>{ONE_ON_ONE_COPY.nobodyYet}</Body>
          ) : (
            open.map((f) => (
              <Tap key={f.id} accessibilityRole="button" onPress={() => onPerson(f)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
                <Avatar name={f.firstName} source={f.photoUrl} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{f.firstName}</Text>
                  {f.area ? <Text style={styles.area}>{f.area}</Text> : null}
                </View>
                <Text style={styles.chevron}>›</Text>
              </Tap>
            ))
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.lg, padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: palette.accent, borderRadius: radius.lg, backgroundColor: palette.surface },
  heading: { fontFamily: fonts.headline, fontSize: 17, color: palette.text, marginBottom: spacing.sm },
  off: { fontSize: 15, lineHeight: 21, color: palette.textMuted },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border },
  name: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  area: { fontSize: 14, color: palette.textMuted, marginTop: 1 },
  chevron: { fontSize: 22, color: palette.textMuted },
});
