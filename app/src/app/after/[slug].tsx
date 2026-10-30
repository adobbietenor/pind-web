// A16 — After the event (M3.3; spec A16, approved by Alex 29 Sept 2026).
//
// Two things, for one gathering:
//   * **Who did you meet?** — for the members of a group of 3+ that reached the end of
//     its gathering, for 7 days after. Per person: "We met", then, once they ticked you
//     too, "Keep in touch"; both ways makes a connection (A20). A tick can be taken back
//     until it is matched. **Nobody learns of a tick they did not return** (Q6): the
//     database computes "matched" only from a tick of yours (`after_state`), so this
//     screen never holds anyone else's unmatched tick to leak.
//   * **One question** for everyone who was open to meeting, group or not: "Would you
//     have gone alone anyway?" — the attendance metric (§7). Asked gently: they said
//     they'd like to meet, and we're asking how the night went (Alex).
//   * **An optional comment** (#10, Alex, 14 Oct 2026): it goes in the same row as the
//     answer, or not at all. Read by its author and people at Pin'd only; deleted with
//     the account (decisions, "A16's comment box").
//     **Picking an answer does not send it** (Tatiana, 21 Oct; Alex, 29 Oct). It used to:
//     the box sat above the answers so it could be filled first, and anyone who answered
//     first — the natural order — never got to write. Now: pick, write if you like, Send.
// #5, the morning after, opens this screen.
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { AFTER_COPY, KEEP_COPY, colors as palette, COMMENT_MAX, commentToSend, fonts, radius, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Choice, Field, Heading, Notice } from "@/components/ui";
import { answer, askKeep, loadAfter, takeBackKeep, type AfterPerson, type AfterView } from "@/lib/after";
import { Avatar } from "@/components/Avatar";
import { Tap } from "@/components/Tap";
import { queryClient } from "@/lib/query";
import { REQUESTS_KEY } from "@/lib/requests";
import { failed, type Described } from "@/lib/errors";

export default function After() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [view, setView] = useState<AfterView | null | undefined>(undefined);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [picked, setPicked] = useState<(typeof AFTER_COPY.answers)[number]["value"] | null>(null);
  // A refusal is said where the tap was (CLAUDE.md, "seen is part of a refusal").
  const [refusedFor, setRefusedFor] = useState<{ key: string; what: Described } | null>(null);

  const refresh = useCallback(() => {
    setTrouble(null);
    loadAfter(slug)
      .then(setView)
      .catch((err) => {
        setTrouble(failed("load this", err));
        setView((v) => v ?? null);
      });
  }, [slug]);
  useFocusEffect(refresh);

  const act = async (key: string, what: string, run: () => Promise<void>) => {
    setBusy(key);
    setRefusedFor(null);
    try {
      await run();
      refresh();
    } catch (err) {
      setRefusedFor({ key, what: failed(what, err) });
    } finally {
      setBusy(null);
    }
  };

  if (view === undefined) {
    return (
      <AppScreen>
        <ActivityIndicator color={palette.text} />
      </AppScreen>
    );
  }
  if (!view) {
    return (
      <AppScreen>
        {trouble ? <Trouble what={trouble} onRetry={refresh} /> : <Notice>There&#39;s nothing here.</Notice>}
      </AppScreen>
    );
  }

  // A16 since UI pass 1 (092): a soft card per person you crossed paths with, where, and
  // its own Keep in touch, which sends a request to their Connections ("✓ Sent"; tap again
  // to take it back while it waits). Already connected says so.
  const person = (p: AfterPerson) => {
    const k = `keep:${p.personId}`;
    const right =
      p.state === "connected" ? (
        <Text style={styles.connected}>{KEEP_COPY.connected}</Text>
      ) : p.state === "sent" ? (
        <Tap
          accessibilityRole="button"
          accessibilityLabel={KEEP_COPY.takeBackLabel(p.firstName)}
          disabled={!view.open || busy === k}
          onPress={() => void act(k, "take that back", () => takeBackKeep(view.gathering.id, p.personId))}
          style={styles.sent}
        >
          <Text style={styles.sentLabel}>{KEEP_COPY.sent}</Text>
        </Tap>
      ) : view.open ? (
        <Tap
          accessibilityRole="button"
          disabled={busy === k}
          onPress={() =>
            void act(k, "send that", async () => {
              await askKeep(view.gathering.id, p.personId);
              void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
            })
          }
          style={styles.keep}
        >
          <Text style={styles.keepLabel}>{KEEP_COPY.keep}</Text>
        </Tap>
      ) : null;
    return (
      <View key={p.personId} style={[styles.keepCard, p.state === "sent" && styles.keepCardSent]}>
        <Avatar name={p.firstName} source={p.photoUrl} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{p.firstName}</Text>
          <Text style={styles.metAs}>{KEEP_COPY.metAs(p.metAs)}</Text>
        </View>
        {right}
        {refusedFor?.key === k ? <Trouble what={refusedFor.what} /> : null}
      </View>
    );
  };
  return (
    <AppScreen>
      <Text style={styles.kicker}>{view.gathering.name}</Text>
      <Heading>{KEEP_COPY.heading}</Heading>
      {view.ended && view.people.length ? <Body muted>{view.open ? KEEP_COPY.line : KEEP_COPY.closed}</Body> : null}
      {trouble ? <Trouble what={trouble} onRetry={refresh} /> : null}

      {!view.ended ? (
        <View style={styles.card}>
          <Body>{AFTER_COPY.notYet}</Body>
        </View>
      ) : null}

      {view.ended && view.people.length ? <View style={{ gap: spacing.sm, marginTop: spacing.md }}>{view.people.map(person)}</View> : null}

      {view.asked ? (
        <View style={styles.card}>
          {view.answered || done ? (
            <Body>{AFTER_COPY.thanks}</Body>
          ) : (
            <>
              {/* "How was it?" (UI pass 1, 097): optional, three taps. Picking is not sending
                  (#10): Done sends the picked answer, and Done with none picked writes nothing. */}
              <View style={styles.qTop}>
                <Text style={styles.section}>{AFTER_COPY.question}</Text>
                <Text style={styles.optional}>{AFTER_COPY.optional}</Text>
              </View>
              <Choice
                label=""
                options={AFTER_COPY.answers.map((a) => ({ value: a.value, name: a.label }))}
                value={picked}
                onChange={setPicked}
              />
              <Button
                kind="quiet"
                label={AFTER_COPY.send}
                busy={busy === "q"}
                disabled={!!busy}
                onPress={() => (picked ? void act("q", "send your answer", () => answer(view.gathering.id, picked)) : setDone(true))}
              />
              {refusedFor?.key === "q" ? <Trouble what={refusedFor.what} /> : null}
            </>
          )}
        </View>
      ) : null}

      {view.ended && !view.people.length && !view.asked ? <Notice>{AFTER_COPY.nothing}</Notice> : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, gap: spacing.sm, marginTop: spacing.md },
  section: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  kicker: { fontFamily: fonts.headline, fontSize: 14, color: palette.accentText, marginBottom: 2 },
  keepCard: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm + 4, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  keepCardSent: { borderColor: palette.accent },
  metAs: { fontSize: 13, color: palette.textMuted, marginTop: 1 },
  keep: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: palette.accent },
  keepLabel: { fontFamily: fonts.headline, fontSize: 14, color: palette.onAccent },
  sent: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.accent },
  sentLabel: { fontFamily: fonts.headline, fontSize: 14, color: palette.accentText },
  connected: { fontFamily: fonts.headline, fontSize: 14, color: "#9BE3A5" },
  qTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  optional: { fontSize: 13, color: palette.textMuted },
  person: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.md, marginTop: spacing.sm, gap: spacing.sm },
  personTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  face: { width: 52, height: 52, borderRadius: 26 },
  faceEmpty: { backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border },
  name: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
});
