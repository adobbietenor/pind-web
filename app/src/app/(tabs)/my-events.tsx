// A19 — My Events: the home for your chats (Alex, 16 Oct 2026). A main screen since then
// (CLAUDE.md): on the night, outside the venue, every chat you belong to is one tap away.
//
// **A chat inbox since UI pass 1** (Alex, 30 Oct 2026; docs/design/ui-pass-1, 107/108):
//
//   * One row per event: a date badge, the name in bold, the room's last message (or a
//     quiet status line when there is none), its time and the unread count. "Live" on
//     tonight's. A tap opens the room when it is open, A16 after the night, the crowd page
//     (A9) otherwise.
//   * Your squad and your 1-on-1 are rows of their own under their event; the women-only
//     room too, with its pink tag.
//   * Grouped Tonight / Coming up / Past. Past rows are grey, "Meeting has ended", and only
//     the latest shows until "Show all past events". Their chats open read-only while
//     retention keeps them (Q11).
//   * Filter chips: All / Unread / Squads. No explanation text.
//   * Pinned but not open to meeting: the row's line says so and the tap goes to A27.
//
// The squads you could join are no longer listed here (they were, from M3.7): the inbox
// is your chats, and joining stays on the crowd page (A15), one tap from the event's row.
//
// One call for the screen (lib/myevents.ts, my_chats); what a row says is decided by
// myEventStatus and the rest of packages/shared/src/myevents.ts. Read fresh whenever the
// tab comes into view (useFocusEffect).
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  chatPreview,
  chatsKept,
  chatsReadOnly,
  chatWhen,
  colors as palette,
  dateBadge,
  fonts,
  INBOX_COPY,
  isTonight,
  MY_CHATS_COPY,
  MY_EVENTS_COPY,
  myEventStatus,
  orderMyChats,
  radius,
  spacing,
  type ChatLast,
  type InboxFilter,
  type MyChatsEvent,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { EmptyCard } from "@/components/EmptyCard";
import { Rise } from "@/components/Motion";
import { Tap } from "@/components/Tap";
import { Trouble } from "@/components/Trouble";
import { Heading } from "@/components/ui";
import { failed } from "@/lib/errors";
import { loadMyChats, MY_CHATS_KEY } from "@/lib/myevents";

// One row of the inbox, whatever it opens.
interface Row {
  key: string;
  kind: "event" | "squad" | "plan" | "women";
  badge: { month: string; day: string };
  title: string;
  live: boolean;
  line: string;
  last: ChatLast | null;
  unread: number;
  readOnly: boolean;
  past: boolean;
  tz: string;
  href: Href;
}

function rowsFor(e: MyChatsEvent, now: Date): Row[] {
  const status = myEventStatus(e, now);
  const tonight = isTonight(e, now);
  const past = status.kind === "met" || status.kind === "tick" || status.kind === "past";
  const readOnly = chatsReadOnly(e, now);
  const kept = chatsKept(e, now);
  const badge = dateBadge(e.startsAt, e.timezone);
  const general = e.rooms.find((r) => !r.womenOnly) ?? null;
  const women = e.rooms.find((r) => r.womenOnly && r !== general) ?? null;
  const base = { badge, tz: e.timezone, past, readOnly };
  const crowd: Href = { pathname: "/crowd/[slug]", params: { slug: e.slug } };

  // The event's own row: the room's conversation, or the quiet line for where you are.
  const line = e.withdrawn
    ? INBOX_COPY.withdrawn
    : status.kind === "tick"
      ? INBOX_COPY.tick
      : status.kind === "met"
        ? INBOX_COPY.endedMet(status.n)
        : past
          ? INBOX_COPY.ended
          : !e.openToMeeting
            ? INBOX_COPY.pinnedOnly
            : general && !general.open
              ? INBOX_COPY.waiting
              : INBOX_COPY.quiet;
  const href: Href =
    status.kind === "tick" || status.kind === "met"
      ? { pathname: "/after/[slug]", params: { slug: e.slug } }
      : !past && !e.withdrawn && !e.openToMeeting
        ? { pathname: "/opt-in/[slug]", params: { slug: e.slug } }
        : general?.open && (!past || kept)
          ? { pathname: "/room/[id]", params: { id: general.roomId } }
          : crowd;
  const rows: Row[] = [
    {
      ...base,
      key: e.gatheringId,
      kind: "event",
      title: e.name,
      live: tonight && Date.parse(e.startsAt) <= now.getTime(),
      line,
      last: general?.open && (!past || kept) ? general.last : null,
      unread: general?.open && !readOnly ? general.unread : 0,
      href,
    },
  ];
  if (women?.open && (!past || kept)) {
    rows.push({ ...base, key: women.roomId, kind: "women", title: INBOX_COPY.womenOnlyRoom, live: false, line: MY_CHATS_COPY.noMessages, last: women.last, unread: readOnly ? 0 : women.unread, href: { pathname: "/room/[id]", params: { id: women.roomId } } });
  }
  // Your squad, then your 1-on-1, in that order under the event (16 Oct, kept in the inbox).
  const squad = e.crews.find((c) => c.kind === "crew");
  const plan = e.crews.find((c) => c.kind === "solo");
  for (const c of [squad, plan]) {
    if (!c || (past && !kept)) continue;
    rows.push({
      ...base,
      key: c.crewId,
      kind: c.kind === "solo" ? "plan" : "squad",
      title: c.kind === "solo" ? MY_CHATS_COPY.plan(c.partner) : c.name ?? MY_CHATS_COPY.yourGroup,
      live: false,
      line: MY_CHATS_COPY.noMessages,
      last: c.last,
      unread: readOnly ? 0 : c.unread,
      href: { pathname: "/group/[id]", params: { id: c.crewId } },
    });
  }
  return rows;
}

export default function MyEvents() {
  const router = useRouter();
  const [showPast, setShowPast] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("all");
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
  const keep = (r: Row) => (filter === "unread" ? r.unread > 0 : filter === "squads" ? r.kind === "squad" : true);
  const groups = [
    { name: INBOX_COPY.tonight, rows: tonight.flatMap((e) => rowsFor(e, now)).filter(keep) },
    { name: INBOX_COPY.comingUp, rows: upcoming.flatMap((e) => rowsFor(e, now)).filter(keep) },
    { name: INBOX_COPY.past, rows: (showPast ? past : past.slice(0, 1)).flatMap((e) => rowsFor(e, now)).filter(keep) },
  ];
  const nothing = groups.every((g) => g.rows.length === 0);

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
      ) : (
        <>
          <View style={styles.filters}>
            {INBOX_COPY.filters.map((f) => (
              <Tap
                key={f.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: filter === f.value }}
                onPress={() => setFilter(f.value)}
                style={[styles.filter, filter === f.value && styles.filterOn]}
              >
                <Text style={[styles.filterLabel, filter === f.value && { color: palette.onAccent }]}>{f.name}</Text>
              </Tap>
            ))}
          </View>
          {nothing ? <Text style={styles.quietNote}>{filter === "unread" ? INBOX_COPY.nothingUnread : INBOX_COPY.noSquads}</Text> : null}
          {groups.map((g) =>
            g.rows.length ? (
              <View key={g.name}>
                <Text style={styles.group}>{g.name}</Text>
                {g.rows.map((r, i) => (
                  <Rise key={r.key} index={i}>
                    <InboxRow row={r} now={now} onPress={() => router.push(r.href)} />
                  </Rise>
                ))}
              </View>
            ) : null,
          )}
          {past.length > 1 ? (
            <Text accessibilityRole="button" onPress={() => setShowPast((s) => !s)} style={styles.showPast}>
              {showPast ? INBOX_COPY.hidePast : INBOX_COPY.showAllPast}
            </Text>
          ) : null}
        </>
      )}
    </AppScreen>
  );
}

function InboxRow({ row, now, onPress }: { row: Row; now: Date; onPress: () => void }) {
  const unread = row.unread > 0 && !row.readOnly;
  const sub = row.kind !== "event";
  return (
    <Tap
      feel="card"
      accessibilityRole="button"
      accessibilityLabel={[row.title, unread ? MY_CHATS_COPY.unreadLabel(row.unread) : null, row.readOnly ? MY_CHATS_COPY.readOnly : null].filter(Boolean).join(", ")}
      onPress={onPress}
      style={styles.row}
    >
      <View style={[styles.badge, sub && styles.badgeSub, row.past && styles.badgePast]}>
        <Text style={[styles.badgeMonth, row.past && styles.faded]}>{row.badge.month}</Text>
        <Text style={[styles.badgeDay, row.past && styles.faded]}>{row.badge.day}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.top}>
          <Text numberOfLines={1} style={[styles.title, row.past && styles.faded]}>
            {row.title}
          </Text>
          {row.live ? <Text style={styles.live}>{INBOX_COPY.live}</Text> : null}
          {row.kind === "women" ? <Text style={styles.women}>Women only</Text> : null}
          <View style={{ flex: 1 }} />
          {row.last ? <Text style={[styles.when, unread && styles.whenUnread]}>{chatWhen(row.last.at, row.tz, now)}</Text> : null}
        </View>
        <View style={styles.top}>
          <Text numberOfLines={1} style={[styles.preview, unread && styles.previewUnread]}>
            {row.last ? chatPreview(row.last, row.line) : row.line}
          </Text>
          {row.readOnly && row.last ? (
            <Text style={styles.readOnly}>{MY_CHATS_COPY.readOnly}</Text>
          ) : unread ? (
            <View style={styles.count}>
              <Text style={styles.countText}>{row.unread > 99 ? "99+" : String(row.unread)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xs },
  filter: { minHeight: 40, justifyContent: "center", paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  filterOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  filterLabel: { fontFamily: fonts.headline, fontSize: 14, color: palette.text },
  group: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginTop: spacing.md, marginBottom: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, minHeight: 72, paddingVertical: spacing.sm + 2, borderBottomWidth: 1, borderBottomColor: palette.border },
  badge: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: palette.accent },
  badgeSub: { backgroundColor: "#3A2A4E" },
  badgePast: { backgroundColor: "#24222A" },
  badgeMonth: { fontFamily: fonts.headline, fontSize: 10, letterSpacing: 0.5, color: "#E9DDF6", lineHeight: 12 },
  badgeDay: { fontFamily: fonts.headline, fontSize: 19, color: palette.onAccent, lineHeight: 22 },
  faded: { color: palette.textMuted },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flexShrink: 1, fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  live: { fontFamily: fonts.headline, fontSize: 11, color: "#9BE3A5", backgroundColor: "#1E3A24", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: "hidden" },
  women: { fontSize: 11, color: "#F7C6DE", backgroundColor: "#3A1F2E", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: "hidden" },
  when: { fontSize: 12, color: palette.textMuted },
  whenUnread: { color: palette.accentText },
  preview: { flex: 1, fontSize: 14, color: palette.textMuted, marginTop: 2 },
  previewUnread: { color: palette.text },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center" },
  countText: { fontSize: 12, fontFamily: fonts.headline, color: palette.onAccent },
  readOnly: { fontSize: 12, color: palette.textMuted },
  showPast: { color: palette.accentText, fontSize: 15, textDecorationLine: "underline", marginTop: spacing.md, paddingVertical: spacing.sm },
  quietNote: { fontSize: 15, color: palette.textMuted, marginTop: spacing.md },
});
