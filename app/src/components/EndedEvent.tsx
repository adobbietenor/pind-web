// A9 for an ended event (#18; Alex, 29 Oct 2026). It says the event has ended, and offers
// each chat you had there by its phase: the last day (writable for 24 h after the end —
// "that's when people say it was good to meet you"), read-only for 30 days, then cleared.
// Never "You're the first here", never a share or a notification prompt, never a squad to
// start or a 1-on-1 list. The date, the venue and the address are A9's own header above.
//
// The chats come from My Events' list (`my_chats`, through RLS), not a second read: the
// same rooms, squads and 1-on-1 plans that tab shows, and the phase rules in
// `@pind/shared` (`endedPhase`, `endedChats`), where E01–E05 test them.
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AFTER_COPY, clockLocal, colors as palette, endedChats, endedPhase, ENDED_COPY, fonts, lastDayCloses, radius, spacing } from "@pind/shared";
import { Body, Button } from "@/components/ui";
import { loadMyChats, MY_CHATS_KEY } from "@/lib/myevents";

const weekdayClock = (iso: string, tz: string) =>
  `${new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "long" }).format(new Date(iso))} at ${clockLocal(iso, tz)}`;

export function EndedEvent({ gatheringId, slug }: { gatheringId: string; slug: string }) {
  const router = useRouter();
  // The tab bar's own query, so this shares its cache rather than asking twice.
  const chats = useQuery({ queryKey: MY_CHATS_KEY, queryFn: loadMyChats, staleTime: 15_000 });
  const e = chats.data?.find((x) => x.gatheringId === gatheringId);
  const now = new Date();
  const phase = e ? endedPhase(e, now) : null;
  const list = e ? endedChats(e, now) : [];

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{ENDED_COPY.heading}</Text>
      {chats.isPending ? (
        <ActivityIndicator color={palette.textMuted} />
      ) : !e || (phase !== "cleared" && list.length === 0) ? (
        <Body muted>{ENDED_COPY.none}</Body>
      ) : (
        <>
          <Body muted>
            {phase === "last-day" ? ENDED_COPY.lastDay(weekdayClock(lastDayCloses(e), e.timezone)) : phase === "read-only" ? ENDED_COPY.readOnly : ENDED_COPY.cleared}
          </Body>
          {list.map((c) => (
            <Button
              key={c.id}
              kind={phase === "last-day" ? "primary" : "quiet"}
              label={`${phase === "last-day" ? ENDED_COPY.open : ENDED_COPY.read}: ${c.label}`}
              onPress={() => router.push(c.kind === "room" ? { pathname: "/room/[id]", params: { id: c.id } } : { pathname: "/group/[id]", params: { id: c.id } })}
            />
          ))}
        </>
      )}
      {/* A group of 3+ keeps its 7 days of ticks (A16). */}
      {e?.after?.open ? <Button kind="quiet" label={AFTER_COPY.howDidItGo} onPress={() => router.push({ pathname: "/after/[slug]", params: { slug } })} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // A9's card (crowd/[slug].tsx, oneStep), so an ended event reads as the same page.
  card: { padding: spacing.lg, borderWidth: 1, borderColor: palette.accent, borderRadius: radius.lg, backgroundColor: palette.surface, gap: spacing.sm, marginTop: spacing.md },
  heading: { fontFamily: fonts.headline, fontSize: 22, color: palette.text },
});
