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
// #5, the morning after, opens this screen.
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { AFTER_COPY, colors as palette, fonts, radius, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { answer, loadAfter, tick, type AfterPerson, type AfterView } from "@/lib/after";
import { failed, type Described } from "@/lib/errors";

export default function After() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [view, setView] = useState<AfterView | null | undefined>(undefined);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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

  const person = (p: AfterPerson) => {
    const k = (kind: string) => `${kind}:${p.personId}`;
    return (
      <View key={p.personId} style={styles.person}>
        <View style={styles.personTop}>
          {p.photoUrl ? <Image source={{ uri: p.photoUrl }} style={styles.face} /> : <View style={[styles.face, styles.faceEmpty]} />}
          <Text style={styles.name}>{p.firstName}</Text>
        </View>
        {!p.weMet ? (
          view.open ? (
            <Button kind="quiet" label={AFTER_COPY.weMet} busy={busy === k("we")} onPress={() => void act(k("we"), "save that", () => tick(view.crewId!, p.personId, "we_met", true))} />
          ) : null
        ) : !p.weMetMatched ? (
          <>
            <Body muted>{AFTER_COPY.ticked}</Body>
            {view.open ? <Button kind="quiet" label={AFTER_COPY.takeBack} busy={busy === k("we")} onPress={() => void act(k("we"), "take that back", () => tick(view.crewId!, p.personId, "we_met", false))} /> : null}
          </>
        ) : (
          <>
            <Body>{AFTER_COPY.matched}</Body>
            {p.keepMatched ? (
              <Body muted>{AFTER_COPY.connected}</Body>
            ) : p.keep ? (
              <>
                <Body muted>{AFTER_COPY.keepTicked}</Body>
                {view.open ? <Button kind="quiet" label={AFTER_COPY.takeBack} busy={busy === k("keep")} onPress={() => void act(k("keep"), "take that back", () => tick(view.crewId!, p.personId, "keep_in_touch", false))} /> : null}
              </>
            ) : view.open ? (
              <Button label={AFTER_COPY.keepInTouch} busy={busy === k("keep")} onPress={() => void act(k("keep"), "save that", () => tick(view.crewId!, p.personId, "keep_in_touch", true))} />
            ) : null}
          </>
        )}
        {refusedFor && refusedFor.key.endsWith(p.personId) ? <Trouble what={refusedFor.what} /> : null}
      </View>
    );
  };

  return (
    <AppScreen>
      <Heading>{AFTER_COPY.heading}</Heading>
      <Body muted>{view.gathering.name}</Body>
      {trouble ? <Trouble what={trouble} onRetry={refresh} /> : null}

      {!view.ended ? (
        <View style={styles.card}>
          <Body>{AFTER_COPY.notYet}</Body>
        </View>
      ) : null}

      {view.crewId ? (
        <View style={styles.card}>
          <Text style={styles.section}>{AFTER_COPY.whoDidYouMeet}</Text>
          <Body muted>{view.open ? AFTER_COPY.tickHint : AFTER_COPY.closed}</Body>
          {view.people.map(person)}
        </View>
      ) : null}

      {view.asked ? (
        <View style={styles.card}>
          {view.answered ? (
            <Body>{AFTER_COPY.thanks}</Body>
          ) : (
            <>
              <Text style={styles.section}>{AFTER_COPY.question}</Text>
              <Body muted>{AFTER_COPY.questionWhy}</Body>
              {AFTER_COPY.answers.map((a) => (
                <Button
                  key={a.value}
                  kind="quiet"
                  label={a.label}
                  busy={busy === `q:${a.value}`}
                  disabled={!!busy}
                  onPress={() => void act(`q:${a.value}`, "save your answer", () => answer(view.gathering.id, a.value))}
                />
              ))}
              {refusedFor?.key.startsWith("q:") ? <Trouble what={refusedFor.what} /> : null}
            </>
          )}
        </View>
      ) : null}

      {view.ended && !view.crewId && !view.asked ? <Notice>{AFTER_COPY.nothing}</Notice> : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, gap: spacing.sm, marginTop: spacing.md },
  section: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  person: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.md, marginTop: spacing.sm, gap: spacing.sm },
  personTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  face: { width: 52, height: 52, borderRadius: 26 },
  faceEmpty: { backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border },
  name: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
});
