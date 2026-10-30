// The messages of a thread — the room (A10), a squad (A11), a 1-on-1 plan (A29) — drawn
// once, so a state a message can be in looks the same in all three (the thread pass,
// 16 Oct 2026).
//
//   * "Earlier messages" at the top when there is history not yet read: a page at a time.
//   * One of mine still in flight reads "Sending…"; one the database refused, or that
//     never got an answer, reads "Not sent — tap to put it back in the box". The tap
//     returns its words to the box and nothing else: it is never sent again for you (S29).
//   * Long-press is the screen's (the room: delete your own, report anyone else's, H9).
//   * A new message slides in from its own side (the "feel alive" pass, 16 Oct 2026) —
//     only one that arrives after the thread is on screen, and only at the end: an older
//     page loaded above does not slide. Mine slides in once, as it is sent; its confirmed
//     copy (a new id) takes its place without sliding again.
import { memo, useCallback, useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ImageSource } from "expo-image";
import { colors as palette, fonts, radius, spacing, THREAD_COPY, type ThreadMessage } from "@pind/shared";
import { Avatar } from "./Avatar";
import { Button } from "./ui";
import { Arrive } from "./Motion";
import { Tap } from "./Tap";

// One formatter for the whole thread: building an Intl.DateTimeFormat per message per render
// was measurable on a slow phone (measure:thread, the "feel alive" pass).
const CLOCK = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" });
const clock = (iso: string) => CLOCK.format(new Date(iso));

// The day a run of messages belongs to, as a pill between them (UI pass 1, 057): "Today",
// "Yesterday", or the date.
const DAY = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric" });
function dayOf(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (key(d) === key(now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (key(d) === key(y)) return "Yesterday";
  return DAY.format(d);
}

// One message. Memoised: sending or receiving one message renders that bubble, not all
// fifty — the merge functions keep an unchanged message the same object, and the handlers
// it gets are stable. Without this, the press and entrance wrappers made every Send ~20 ms
// slower to reach the screen on the mobile profile.
const Bubble = memo(function Bubble({
  m,
  mine,
  who,
  face,
  showName,
  showFace,
  animate,
  holdable,
  onTakeBack,
  onLongPress,
}: {
  m: ThreadMessage;
  mine: boolean;
  who: string;
  face: ImageSource | string | null | undefined;
  showName: boolean;
  showFace: boolean;
  animate: boolean;
  holdable: boolean;
  onTakeBack: (localId: string) => void;
  onLongPress: (m: ThreadMessage) => void;
}) {
  const failed = m.status === "failed";
  // A group chat's bubble (UI pass 1, 057): theirs on the left with their face and name,
  // mine on the right in purple, the time tucked in the corner of each.
  const time = m.status === "sending" ? THREAD_COPY.sending : failed ? THREAD_COPY.notSent : clock(m.createdAt);
  return (
    <Arrive fromRight={mine} animate={animate}>
      <View style={[styles.line, mine && styles.lineMine]}>
        {!mine ? <View style={styles.faceSlot}>{showFace ? <Avatar name={who} source={face} size={28} /> : null}</View> : null}
        <Tap
          accessibilityRole={failed ? "button" : undefined}
          accessibilityLabel={`${mine ? "You" : who}, ${time}: ${m.body}`}
          onPress={failed ? () => onTakeBack(m.id) : undefined}
          onLongPress={!m.status && holdable ? () => onLongPress(m) : undefined}
          style={[styles.bubble, mine ? styles.mine : styles.theirs, m.status === "sending" && styles.sending, failed && styles.failed]}
        >
          {!mine && showName ? <Text style={styles.who}>{who}</Text> : null}
          <Text style={styles.body}>{m.body}</Text>
          <Text style={[styles.time, mine && styles.timeMine, failed && styles.failedText]}>{time}</Text>
        </Tap>
      </View>
    </Arrive>
  );
});

export function ThreadMessages({
  messages,
  meId,
  nameOf,
  hasOlder,
  olderBusy,
  onOlder,
  onTakeBack,
  onLongPress,
  faceOf,
}: {
  messages: ThreadMessage[];
  meId: string;
  nameOf: (authorId: string) => string;
  // The author's face, for the bubble's left edge; a letter when there is none.
  faceOf?: (authorId: string) => ImageSource | string | null | undefined;
  hasOlder: boolean;
  olderBusy: boolean;
  onOlder: () => void;
  onTakeBack: (localId: string) => void;
  onLongPress?: (m: ThreadMessage) => void;
}) {
  // Every id this list has drawn. Empty until the first render with messages, so the
  // thread a person opens never slides in — only what arrives while they look.
  const drawn = useRef(new Set<string>());
  useEffect(() => {
    for (const m of messages) drawn.current.add(m.id);
  }, [messages]);
  let lastDrawn = -1;
  messages.forEach((m, i) => {
    if (drawn.current.has(m.id)) lastDrawn = i;
  });
  const arrives = (m: ThreadMessage, i: number) =>
    drawn.current.size > 0 && !drawn.current.has(m.id) && i > lastDrawn && !(m.authorId === meId && !m.status);

  // The screen's handlers change every render; the bubbles get stable ones that call the latest.
  const latest = useRef({ onTakeBack, onLongPress });
  latest.current = { onTakeBack, onLongPress };
  const takeBack = useCallback((id: string) => latest.current.onTakeBack(id), []);
  const hold = useCallback((m: ThreadMessage) => latest.current.onLongPress?.(m), []);

  return (
    <View style={styles.list}>
      {hasOlder ? <Button kind="quiet" label={THREAD_COPY.earlier} busy={olderBusy} onPress={onOlder} /> : null}
      {messages.map((m, i) => {
        const mine = m.authorId === meId;
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const day = dayOf(m.createdAt);
        const newDay = !prev || dayOf(prev.createdAt) !== day;
        // A run of one person's messages carries their name once at the top and their
        // face once at the bottom, as a group chat does.
        const startsRun = newDay || prev.authorId !== m.authorId;
        const endsRun = !next || next.authorId !== m.authorId || dayOf(next.createdAt) !== day;
        const bubble = (
          <Bubble
            key={m.id}
            m={m}
            mine={mine}
            who={mine ? "You" : nameOf(m.authorId)}
            face={faceOf?.(m.authorId)}
            showName={startsRun}
            showFace={endsRun}
            animate={arrives(m, i)}
            holdable={!!onLongPress}
            onTakeBack={takeBack}
            onLongPress={hold}
          />
        );
        return newDay ? (
          <View key={m.id} style={{ gap: spacing.sm }}>
            <Text style={styles.day}>{day}</Text>
            {bubble}
          </View>
        ) : (
          bubble
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: spacing.md, gap: 6 },
  line: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  lineMine: { justifyContent: "flex-end" },
  faceSlot: { width: 28 },
  bubble: { paddingVertical: spacing.sm, paddingHorizontal: 12, borderRadius: radius.md + 2, maxWidth: "80%", flexShrink: 1 },
  mine: { backgroundColor: palette.accent, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: "#1C1A22", borderBottomLeftRadius: 4 },
  sending: { opacity: 0.7 },
  failed: { backgroundColor: palette.surface, borderWidth: 1, borderColor: "#E06B6B" },
  who: { fontFamily: fonts.headline, fontSize: 13, color: palette.accentText, marginBottom: 2 },
  failedText: { color: "#F3B4B4" },
  body: { fontSize: 15, lineHeight: 21, color: palette.text },
  time: { fontSize: 11, color: palette.textMuted, alignSelf: "flex-end", marginTop: 2 },
  timeMine: { color: "#E2CFFA" },
  day: { alignSelf: "center", fontSize: 12, color: palette.textMuted, backgroundColor: "#1C1A22", paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999, overflow: "hidden", marginVertical: spacing.xs },
});
