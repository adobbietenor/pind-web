// A19 — My Events: the home for your chats (Alex, 16 Oct 2026). A main screen since then
// (CLAUDE.md), no longer a plain list: on the night, outside the venue, every chat you
// belong to is one tap from this tab.
//
//   * Each event you pinned is a section, soonest first; **tonight's is on top** and
//     marked. Its header still opens the crowd page (A9) — another way into the same chats.
//   * Under it, in this order: "Everyone going" (the room), your squad, your 1-on-1 plan —
//     each a chat row: name, last message, its time, unread count; one tap opens the
//     thread. Then the squads open to you, quieter: a tap offers to join (A15's own join),
//     never opens a thread you are not in.
//   * Pinned but not open to meeting: no chats, so the section says how to be, with the
//     way to A27 — never an empty section.
//   * Past events below, newest first, folded away. Their chats open read-only while
//     retention keeps them (Q11); after that the event stays, with no chat.
//
// One call for the screen (lib/myevents.ts, my_chats); what each line says is decided by
// myEventStatus and the rest of packages/shared/src/myevents.ts (M01–M16). Tap, Rise and
// the press motion throughout, instant under Reduce Motion. Read fresh whenever the tab
// comes into view (useFocusEffect).
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  chatPreview,
  chatsKept,
  chatsReadOnly,
  chatWhen,
  clockLocal,
  colors as palette,
  fonts,
  formatLocal,
  isTonight,
  MY_CHATS_COPY,
  MY_EVENTS_COPY,
  myEventSoloLine,
  myEventStatus,
  orderMyChats,
  radius,
  spacing,
  type ChatLast,
  type MyChatsEvent,
  type OpenSquad,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { EmptyCard } from "@/components/EmptyCard";
import { Rise } from "@/components/Motion";
import { Tap } from "@/components/Tap";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading } from "@/components/ui";
import { failed } from "@/lib/errors";
import { loadMyChats, MY_CHATS_KEY } from "@/lib/myevents";
import { joinSquad } from "@/lib/squads";

export default function MyEvents() {
  const router = useRouter();
  const [showPast, setShowPast] = useState(false);
  const chats = useQuery({ queryKey: MY_CHATS_KEY, queryFn: loadMyChats, staleTime: 15_000 });
  const { refetch } = chats;

  // Fresh on every visit: a pin removed elsewhere, or a thread just read, shows at once.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  if (chats.error) {
    return (
      <AppScreen>
        <Heading>{MY_EVENTS_COPY.title}</Heading>
        <Trouble what={failed("load your events", chats.error)} onRetry={() => void refetch()} />
      </AppScreen>
    );
  }
  if (!chats.data) {
    return (
      <AppScreen scroll={false}>
        <Heading>{MY_EVENTS_COPY.title}</Heading>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  const now = new Date();
  const { tonight, upcoming, past } = orderMyChats(chats.data, now);
  const section = (e: MyChatsEvent, i: number) => <EventSection key={e.gatheringId} e={e} index={i} now={now} onChanged={() => void refetch()} />;

  return (
    <AppScreen>
      <Heading>{MY_EVENTS_COPY.title}</Heading>
      {chats.data.length === 0 ? (
        <EmptyCard
          icon="pin"
          heading={MY_EVENTS_COPY.emptyHeading}
          line={MY_EVENTS_COPY.empty}
          button={MY_EVENTS_COPY.emptyLink}
          onPress={() => router.push("/crowds")}
        />
      ) : null}
      {tonight.map(section)}
      {upcoming.map((e, i) => section(e, tonight.length + i))}
      {past.length ? (
        <>
          <Tap accessibilityRole="button" accessibilityState={{ expanded: showPast }} onPress={() => setShowPast((s) => !s)} style={styles.pastToggle}>
            <Text style={styles.pastToggleText}>{MY_CHATS_COPY.pastToggle(past.length, showPast)}</Text>
          </Tap>
          {showPast ? past.map(section) : null}
        </>
      ) : null}
    </AppScreen>
  );
}

function EventSection({ e, index, now, onChanged }: { e: MyChatsEvent; index: number; now: Date; onChanged: () => void }) {
  const router = useRouter();
  const [joining, setJoining] = useState<string | null>(null);
  const [joinNote, setJoinNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = myEventStatus(e, now);
  const line = MY_EVENTS_COPY.status(status, (iso) => clockLocal(iso, e.timezone));
  const solo = myEventSoloLine(e, now, (iso) => clockLocal(iso, e.timezone));
  const tonight = isTonight(e, now);
  const past = status.kind === "met" || status.kind === "tick" || status.kind === "past";
  const readOnly = chatsReadOnly(e, now);
  const kept = chatsKept(e, now);
  const squad = e.crews.find((c) => c.kind === "crew");
  const plan = e.crews.find((c) => c.kind === "solo");
  // The header: A16 for the ticks after the night, the crowd page (A9) otherwise.
  const openEvent = () =>
    status.kind === "tick" || status.kind === "met"
      ? router.push({ pathname: "/after/[slug]", params: { slug: e.slug } })
      : router.push({ pathname: "/crowd/[slug]", params: { slug: e.slug } });

  const join = async (s: OpenSquad) => {
    setBusy(true);
    setJoinNote(null);
    try {
      await joinSquad(s.crewId);
      onChanged();
      router.push({ pathname: "/group/[id]", params: { id: s.crewId } });
    } catch (err) {
      // A refusal is the database's, in words (squadRefusal) — said here, where the tap was.
      setJoinNote(failed("join that squad", err).says);
    } finally {
      setBusy(false);
    }
  };

  let row = 0;
  return (
    <Rise index={index} style={[styles.event, tonight && styles.tonight]}>
      <Tap feel="card" accessibilityRole="link" onPress={openEvent} style={styles.header}>
        {tonight ? <Text style={styles.tonightPill}>{MY_CHATS_COPY.tonight}</Text> : null}
        <Text style={styles.when}>{formatLocal(e.startsAt, e.timezone)}</Text>
        <Text style={styles.name}>{e.name}</Text>
        {e.venue ? <Text style={styles.where}>{e.venue}</Text> : null}
        {line ? <Text style={styles.status}>{line}</Text> : null}
        {solo ? <Text style={styles.status}>{solo}</Text> : null}
      </Tap>

      {/* Pinned, not open to meeting: how to be, never an empty section. */}
      {!past && !e.withdrawn && !e.openToMeeting ? (
        <View style={styles.optIn}>
          <Body muted>{MY_CHATS_COPY.pinnedOnly}</Body>
          <Button kind="quiet" label={MY_CHATS_COPY.pinnedOnlyAction} onPress={() => router.push({ pathname: "/opt-in/[slug]", params: { slug: e.slug } })} />
        </View>
      ) : null}

      {/* 1 · Everyone going — the room (and the women-only room, if you are in it). Before
          a second person says yes there is no room to open: the row says so, and goes to A9. */}
      {e.rooms.map((r) => (
        <Rise key={r.roomId} index={row++}>
          <ChatRow
            title={r.womenOnly ? MY_CHATS_COPY.everyoneGoingWomen : MY_CHATS_COPY.everyoneGoing}
            last={r.open ? r.last : null}
            empty={r.open ? MY_CHATS_COPY.noMessages : MY_CHATS_COPY.firstHere}
            unread={r.open ? r.unread : 0}
            readOnly={r.open && readOnly}
            tz={e.timezone}
            now={now}
            onPress={() =>
              r.open
                ? router.push({ pathname: "/room/[id]", params: { id: r.roomId } })
                : router.push({ pathname: "/crowd/[slug]", params: { slug: e.slug } })
            }
          />
        </Rise>
      ))}

      {/* 2 · My squad. 3 · My 1-on-1 plan. */}
      {[squad, plan].map((c) =>
        c ? (
          <Rise key={c.crewId} index={row++}>
            <ChatRow
              title={c.kind === "solo" ? MY_CHATS_COPY.plan(c.partner) : c.name ?? MY_CHATS_COPY.yourGroup}
              last={c.last}
              unread={c.unread}
              readOnly={readOnly}
              tz={e.timezone}
              now={now}
              onPress={() => router.push({ pathname: "/group/[id]", params: { id: c.crewId } })}
            />
          </Rise>
        ) : null,
      )}

      {/* After retention (Q11): the event stays, with no chat. */}
      {past && !kept && e.openToMeeting ? <Text style={styles.quiet}>{MY_CHATS_COPY.noChatsKept}</Text> : null}

      {/* 4 · Squads I could join — quieter; a tap offers to join, it never opens a thread. */}
      {e.openSquads.length ? (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={styles.openHeading}>{MY_CHATS_COPY.openSquads}</Text>
          {e.openSquads.map((s) => (
            <Rise key={s.crewId} index={row++}>
              <Tap
                accessibilityRole="button"
                accessibilityState={{ expanded: joining === s.crewId }}
                onPress={() => {
                  setJoinNote(null);
                  setJoining((j) => (j === s.crewId ? null : s.crewId));
                }}
                style={styles.openRow}
              >
                <Text style={styles.openName}>{s.name}</Text>
                <Text style={styles.openMeta}>
                  {s.full ? MY_CHATS_COPY.full : MY_CHATS_COPY.squadLine(s.spot, clockLocal(s.meetAt, e.timezone), s.seats)}
                </Text>
              </Tap>
              {joining === s.crewId ? (
                <View style={styles.joinCard}>
                  {joinNote ? (
                    <Text accessibilityRole="alert" style={styles.refusal}>
                      {joinNote}
                    </Text>
                  ) : null}
                  {!s.full ? <Button label={MY_CHATS_COPY.join} haptic="action" busy={busy} onPress={() => void join(s)} /> : null}
                  <Button kind="quiet" label={MY_CHATS_COPY.joinCancel} onPress={() => setJoining(null)} />
                </View>
              ) : null}
            </Rise>
          ))}
        </View>
      ) : null}
    </Rise>
  );
}

function ChatRow({
  title,
  last,
  empty = MY_CHATS_COPY.noMessages,
  unread,
  readOnly,
  tz,
  now,
  onPress,
}: {
  title: string;
  last: ChatLast | null;
  empty?: string;
  unread: number;
  readOnly: boolean;
  tz: string;
  now: Date;
  onPress: () => void;
}) {
  const hasUnread = unread > 0 && !readOnly;
  return (
    <Tap
      feel="card"
      accessibilityRole="button"
      accessibilityLabel={[title, hasUnread ? MY_CHATS_COPY.unreadLabel(unread) : null, readOnly ? MY_CHATS_COPY.readOnly : null].filter(Boolean).join(", ")}
      onPress={onPress}
      style={styles.chat}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.chatTop}>
          <Text numberOfLines={1} style={styles.chatTitle}>
            {title}
          </Text>
          {last ? <Text style={[styles.chatWhen, hasUnread && styles.chatWhenUnread]}>{chatWhen(last.at, tz, now)}</Text> : null}
        </View>
        <View style={styles.chatTop}>
          <Text numberOfLines={1} style={[styles.preview, hasUnread && styles.previewUnread]}>
            {chatPreview(last, empty)}
          </Text>
          {readOnly ? (
            <Text style={styles.readOnly}>{MY_CHATS_COPY.readOnly}</Text>
          ) : hasUnread ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread > 99 ? "99+" : String(unread)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  link: { color: palette.accentText, fontFamily: fonts.headline, fontSize: 15, marginTop: spacing.sm },
  event: { marginTop: spacing.lg, borderRadius: radius.md },
  tonight: { borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.surface, padding: spacing.sm },
  tonightPill: {
    alignSelf: "flex-start",
    backgroundColor: palette.accent,
    color: palette.onAccent,
    fontFamily: fonts.headline,
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 4,
  },
  header: { paddingVertical: spacing.sm, paddingHorizontal: 4 },
  when: { fontSize: 13, color: palette.textMuted },
  name: { fontFamily: fonts.headline, fontSize: 18, color: palette.text, marginTop: 2 },
  where: { fontSize: 14, color: palette.textMuted, marginTop: 2 },
  status: { fontSize: 14, color: palette.accentText, marginTop: 4 },
  optIn: { gap: spacing.sm, marginTop: spacing.xs },
  chat: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
  },
  chatTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chatTitle: { flex: 1, fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  chatWhen: { fontSize: 12, color: palette.textMuted },
  chatWhenUnread: { color: palette.accentText },
  preview: { flex: 1, fontSize: 14, color: palette.textMuted, marginTop: 2 },
  previewUnread: { color: palette.text },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 12, fontFamily: fonts.headline, color: palette.onAccent },
  readOnly: { fontSize: 12, color: palette.textMuted },
  openHeading: { fontSize: 13, color: palette.textMuted, marginTop: spacing.sm, marginBottom: 2, paddingHorizontal: 4 },
  openRow: { paddingVertical: 10, paddingHorizontal: 14, marginTop: 4, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, borderStyle: "dashed" },
  openName: { fontSize: 15, color: palette.text },
  openMeta: { fontSize: 13, color: palette.textMuted, marginTop: 2 },
  joinCard: { gap: spacing.sm, marginTop: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surface },
  refusal: { fontSize: 14, color: "#F3B4B4" },
  quiet: { fontSize: 14, color: palette.textMuted, marginTop: spacing.sm, paddingHorizontal: 4 },
  pastToggle: { marginTop: spacing.xl, paddingVertical: spacing.sm },
  pastToggleText: { fontFamily: fonts.headline, fontSize: 15, color: palette.textMuted },
});
