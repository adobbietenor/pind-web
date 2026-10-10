// A19 — My Events (M3.2b; Alex, 10 Oct 2026: the room era's reading, no new toggle).
//
// The gatherings you have pinned: coming up, soonest first, with your group's spot and
// time when you are in one; and been, most recent first, with whether you ticked "we
// met" (A16). The day-of switch is the one in Settings (#4), not one per gathering.
// Read fresh on every visit, so a pin removed elsewhere is gone here (lib/myevents.ts).
// Each line is decided by myEventStatus in packages/shared (M01–M06). A plain screen
// (CLAUDE.md: My Events can stay plain).
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { clockLocal, colors as palette, fonts, formatLocal, MY_EVENTS_COPY, myEventStatus, radius, spacing, splitMyEvents } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Heading } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { loadMyEvents, type MyEvent } from "@/lib/myevents";

export default function MyEvents() {
  const router = useRouter();
  const [events, setEvents] = useState<MyEvent[] | null>(null);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      setTrouble(null);
      loadMyEvents()
        .then((e) => live && setEvents(e))
        .catch((err) => live && setTrouble(failed("load your events", err)));
      return () => {
        live = false;
      };
    }, [attempt]),
  );

  if (trouble) {
    return (
      <AppScreen>
        <Heading>{MY_EVENTS_COPY.title}</Heading>
        <Trouble what={trouble} onRetry={() => setAttempt((n) => n + 1)} />
      </AppScreen>
    );
  }

  if (!events) {
    return (
      <AppScreen scroll={false}>
        <Heading>{MY_EVENTS_COPY.title}</Heading>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  const now = new Date();
  const { upcoming, past } = splitMyEvents(events, now);
  const open = (e: MyEvent) => {
    const s = myEventStatus(e, now);
    // The tick prompt goes to A16; everything else to the crowd page (A8).
    if (s.kind === "tick" || s.kind === "met") router.push({ pathname: "/after/[slug]", params: { slug: e.slug } });
    else router.push({ pathname: "/crowd/[slug]", params: { slug: e.slug } });
  };

  return (
    <AppScreen>
      <Heading>{MY_EVENTS_COPY.title}</Heading>
      {events.length === 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Body muted>{MY_EVENTS_COPY.empty}</Body>
          <Text accessibilityRole="link" onPress={() => router.push("/crowds")} style={styles.link}>
            {MY_EVENTS_COPY.emptyLink}
          </Text>
        </View>
      ) : null}
      {upcoming.length ? <Section title={MY_EVENTS_COPY.upcoming} rows={upcoming} now={now} onOpen={open} /> : null}
      {past.length ? <Section title={MY_EVENTS_COPY.past} rows={past} now={now} onOpen={open} /> : null}
    </AppScreen>
  );
}

function Section({ title, rows, now, onOpen }: { title: string; rows: MyEvent[]; now: Date; onOpen: (e: MyEvent) => void }) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={styles.section}>{title}</Text>
      {rows.map((e) => {
        const line = MY_EVENTS_COPY.status(myEventStatus(e, now), (iso) => clockLocal(iso, e.timezone));
        return (
          <Pressable key={e.gatheringId} accessibilityRole="link" onPress={() => onOpen(e)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
            <Text style={styles.when}>{formatLocal(e.startsAt, e.timezone)}</Text>
            <Text style={styles.name}>{e.name}</Text>
            {e.venue ? <Text style={styles.where}>{e.venue}</Text> : null}
            {line ? <Text style={styles.status}>{line}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginBottom: spacing.xs },
  card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, marginTop: spacing.sm, gap: 2 },
  when: { fontSize: 13, color: palette.accentText },
  name: { fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  where: { fontSize: 14, color: palette.textMuted },
  status: { fontSize: 14, color: palette.text, marginTop: 4 },
  link: { color: palette.accentText, marginTop: spacing.sm, textDecorationLine: "underline" },
});
