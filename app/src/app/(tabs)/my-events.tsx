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
// **Round 3 (item 11, Alex, 30 Oct 2026)**: the event is a heading (badge, name, Live) and
// every chat under it says what kind it is at a glance, by icon and tag, not colour alone:
// the Pin'd Meeting Room first, every time ("Everyone going"), the women-only room, your
// squad (its circles, "Squad · 3 of you"), your 1-on-1 (their photo, "1-on-1").
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
import type { ImageSource } from "expo-image";
import { AppScreen } from "@/components/AppScreen";
import { Avatar, AvatarStack } from "@/components/Avatar";
import { EmptyCard } from "@/components/EmptyCard";
import { Icon } from "@/components/Icon";
import { Rise } from "@/components/Motion";
import { Tap } from "@/components/Tap";
import { Trouble } from "@/components/Trouble";
import { Heading } from "@/components/ui";
import { failed } from "@/lib/errors";
import { loadMyChats, MY_CHATS_KEY } from "@/lib/myevents";
import { faceSource, signedPhotoUrls } from "@/lib/signed-photos";

// One chat row of the inbox, whatever it opens. Since round 3 (item 11) each says what kind
// of chat it is by its icon and a small tag, never by colour alone: the Meeting Room (the
// purple room icon, "Everyone going"), the women-only room, a squad (its circles, "Squad ·
// 3 of you") and a 1-on-1 (the other person's photo, "1-on-1").
type Face = { id: string; firstName: string; photoPath: string | null };
interface Row {
  key: string;
  kind: "room" | "squad" | "plan" | "women";
  title: string;
  tag: string;
  faces: Face[];
  line: string;
  last: ChatLast | null;
  unread: number;
  readOnly: boolean;
  past: boolean;
  tz: string;
  href: Href;
}

// An event, as the heading its chats sit under: the date badge, the name, "Live".
interface EventHead {
  key: string;
  badge: { month: string; day: string };
  title: string;
  live: boolean;
  past: boolean;
  href: Href;
  rows: Row[];
}

function eventFor(e: MyChatsEvent, now: Date): EventHead {
  const status = myEventStatus(e, now);
  const tonight = isTonight(e, now);
  const past = status.kind === "met" || status.kind === "tick" || status.kind === "past";
  const readOnly = chatsReadOnly(e, now);
  const kept = chatsKept(e, now);
  const badge = dateBadge(e.startsAt, e.timezone);
  const general = e.rooms.find((r) => !r.womenOnly) ?? null;
  const women = e.rooms.find((r) => r.womenOnly && r !== general) ?? null;
  const base = { tz: e.timezone, past, readOnly };
  const crowd: Href = { pathname: "/crowd/[slug]", params: { slug: e.slug } };
  const after: Href = { pathname: "/after/[slug]", params: { slug: e.slug } };

  // The Meeting Room's row, first under its event every time: the room's conversation, or
  // the quiet line for where you are.
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
      ? after
      : !past && !e.withdrawn && !e.openToMeeting
        ? { pathname: "/opt-in/[slug]", params: { slug: e.slug } }
        : general?.open && (!past || kept)
          ? { pathname: "/room/[id]", params: { id: general.roomId } }
          : crowd;
  const rows: Row[] = [
    {
      ...base,
      key: `${e.gatheringId}:room`,
      kind: "room",
      title: INBOX_COPY.meetingRoom,
      tag: INBOX_COPY.everyoneTag,
      faces: [],
      line,
      last: general?.open && (!past || kept) ? general.last : null,
      unread: general?.open && !readOnly ? general.unread : 0,
      href,
    },
  ];
  if (women?.open && (!past || kept)) {
    rows.push({ ...base, key: women.roomId, kind: "women", title: INBOX_COPY.womenOnlyRoom, tag: INBOX_COPY.womenOnlyTag, faces: [], line: MY_CHATS_COPY.noMessages, last: women.last, unread: readOnly ? 0 : women.unread, href: { pathname: "/room/[id]", params: { id: women.roomId } } });
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
      title: c.kind === "solo" ? c.partner ?? MY_CHATS_COPY.plan(null) : c.name ?? MY_CHATS_COPY.yourGroup,
      tag: c.kind === "solo" ? INBOX_COPY.oneOnOneTag : INBOX_COPY.squadTag(c.members),
      faces: c.faces,
      line: MY_CHATS_COPY.noMessages,
      last: c.last,
      unread: readOnly ? 0 : c.unread,
      href: { pathname: "/group/[id]", params: { id: c.crewId } },
    });
  }
  return {
    key: e.gatheringId,
    badge,
    title: e.name,
    live: tonight && Date.parse(e.startsAt) <= now.getTime(),
    past,
    href: status.kind === "tick" || status.kind === "met" ? after : crowd,
    rows,
  };
}

// Every face on the screen, signed once (V6: a signed URL only after can_see_photo).
function useFaces(events: MyChatsEvent[] | undefined) {
  const paths = [...new Set((events ?? []).flatMap((e) => e.crews.flatMap((c) => c.faces.map((f) => f.photoPath))).filter((p): p is string => !!p))].sort();
  const urls = useQuery({ queryKey: ["my-chats-faces", paths], queryFn: () => signedPhotoUrls(paths), enabled: paths.length > 0, staleTime: 60_000 });
  return (f: Face) => {
    const url = f.photoPath ? urls.data?.get(f.photoPath) : undefined;
    return url && f.photoPath ? faceSource(url, f.photoPath) : null;
  };
}

export default function MyEvents() {
  const router = useRouter();
  const [showPast, setShowPast] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const chats = useQuery({ queryKey: MY_CHATS_KEY, queryFn: loadMyChats, staleTime: 15_000 });
  const { refetch } = chats;
  const faceOf = useFaces(chats.data);

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
  // An event shows under a filter when any of its chats does; under All, always.
  const heads = (list: MyChatsEvent[]) =>
    list
      .map((e) => eventFor(e, now))
      .map((h) => ({ ...h, rows: h.rows.filter(keep) }))
      .filter((h) => filter === "all" || h.rows.length > 0);
  const groups = [
    { name: INBOX_COPY.tonight, events: heads(tonight) },
    { name: INBOX_COPY.comingUp, events: heads(upcoming) },
    { name: INBOX_COPY.past, events: heads(showPast ? past : past.slice(0, 1)) },
  ];
  const nothing = groups.every((g) => g.events.length === 0);

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
            g.events.length ? (
              <View key={g.name}>
                <Text style={styles.group}>{g.name}</Text>
                {g.events.map((h, i) => (
                  <Rise key={h.key} index={i}>
                    <EventRow head={h} onPress={() => router.push(h.href)} />
                    {h.rows.map((r) => (
                      <InboxRow key={r.key} row={r} now={now} faceOf={faceOf} onPress={() => router.push(r.href)} />
                    ))}
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

// The event a set of chats belongs to: its date badge, its name, "Live". A tap opens its
// crowd page (A16 when the night asks who you met).
function EventRow({ head, onPress }: { head: EventHead; onPress: () => void }) {
  return (
    <Tap feel="card" accessibilityRole="button" accessibilityLabel={head.title} onPress={onPress} style={styles.event}>
      <View style={[styles.badge, head.past && styles.badgePast]}>
        <Text style={[styles.badgeMonth, head.past && styles.faded]}>{head.badge.month}</Text>
        <Text style={[styles.badgeDay, head.past && styles.faded]}>{head.badge.day}</Text>
      </View>
      <Text numberOfLines={2} style={[styles.eventTitle, head.past && styles.faded]}>
        {head.title}
      </Text>
      {head.live ? <Text style={styles.live}>{INBOX_COPY.live}</Text> : null}
    </Tap>
  );
}

// What kind of chat, by its picture: the room icon on purple, the room icon on pink, the
// squad's circles, the other person's face.
function KindMark({ row, faceOf }: { row: Row; faceOf: (f: Face) => ImageSource | null }) {
  if (row.kind === "room" || row.kind === "women") {
    const women = row.kind === "women";
    return (
      <View style={[styles.mark, women ? styles.markWomen : styles.markRoom, row.past && styles.badgePast]}>
        <Icon name="chat" size={20} color={women ? "#F7C6DE" : palette.onAccent} />
      </View>
    );
  }
  if (row.kind === "plan") {
    const f = row.faces[0];
    return <Avatar name={f?.firstName || row.title} source={f ? faceOf(f) : null} size={44} />;
  }
  return (
    <View style={styles.markSquad}>
      {row.faces.length ? <AvatarStack size={28} max={3} people={row.faces.map((f) => ({ id: f.id, name: f.firstName, source: faceOf(f) }))} /> : <Avatar name={row.title} source={null} size={44} />}
    </View>
  );
}

function InboxRow({ row, now, faceOf, onPress }: { row: Row; now: Date; faceOf: (f: Face) => ImageSource | null; onPress: () => void }) {
  const unread = row.unread > 0 && !row.readOnly;
  return (
    <Tap
      feel="card"
      accessibilityRole="button"
      accessibilityLabel={[row.title, row.tag, unread ? MY_CHATS_COPY.unreadLabel(row.unread) : null, row.readOnly ? MY_CHATS_COPY.readOnly : null].filter(Boolean).join(", ")}
      onPress={onPress}
      style={styles.row}
    >
      <KindMark row={row} faceOf={faceOf} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.top}>
          <Text numberOfLines={1} style={[styles.title, row.past && styles.faded]}>
            {row.title}
          </Text>
          <View style={{ flex: 1 }} />
          {row.last ? <Text numberOfLines={1} style={[styles.when, unread && styles.whenUnread]}>{chatWhen(row.last.at, row.tz, now)}</Text> : null}
        </View>
        {/* The kind, on its own line so the name is never cut short for it. */}
        <View style={styles.tagLine}>
          <Text numberOfLines={1} style={[styles.tag, row.kind === "women" && styles.tagWomen, row.kind === "room" && styles.tagRoom]}>
            {row.tag}
          </Text>
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
  event: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, minHeight: 56, paddingTop: spacing.md, paddingBottom: spacing.xs },
  eventTitle: { flexShrink: 1, fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  // Chat rows sit under their event, indented to the badge's edge.
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, minHeight: 68, marginLeft: 20, paddingLeft: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#3A2A4E" },
  badgePast: { backgroundColor: "#24222A" },
  mark: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  markRoom: { backgroundColor: palette.accent },
  markWomen: { backgroundColor: "#3A1F2E" },
  markSquad: { width: 44, minHeight: 44, alignItems: "flex-start", justifyContent: "center" },
  tagLine: { flexDirection: "row", marginTop: 3 },
  tag: { flexShrink: 0, fontSize: 11, color: palette.textMuted, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: "hidden" },
  tagRoom: { color: "#E9DDF6", borderColor: palette.accent },
  tagWomen: { color: "#F7C6DE", backgroundColor: "#3A1F2E", borderColor: "#3A1F2E" },
  badgeMonth: { fontFamily: fonts.headline, fontSize: 10, letterSpacing: 0.5, color: "#E9DDF6", lineHeight: 12 },
  badgeDay: { fontFamily: fonts.headline, fontSize: 19, color: palette.onAccent, lineHeight: 22 },
  faded: { color: palette.textMuted },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flexShrink: 1, fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  live: { fontFamily: fonts.headline, fontSize: 11, color: "#9BE3A5", backgroundColor: "#1E3A24", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: "hidden" },
  when: { fontSize: 12, color: palette.textMuted, flexShrink: 0 },
  whenUnread: { color: palette.accentText },
  preview: { flex: 1, fontSize: 14, color: palette.textMuted, marginTop: 2 },
  previewUnread: { color: palette.text },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center" },
  countText: { fontSize: 12, fontFamily: fonts.headline, color: palette.onAccent },
  readOnly: { fontSize: 12, color: palette.textMuted },
  showPast: { color: palette.accentText, fontSize: 15, textDecorationLine: "underline", marginTop: spacing.md, paddingVertical: spacing.sm },
  quietNote: { fontSize: 15, color: palette.textMuted, marginTop: spacing.md },
});
