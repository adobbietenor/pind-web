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
import { colors as palette, radius, spacing, THREAD_COPY, type ThreadMessage } from "@pind/shared";
import { Button } from "./ui";
import { Arrive } from "./Motion";
import { Tap } from "./Tap";

// One formatter for the whole thread: building an Intl.DateTimeFormat per message per render
// was measurable on a slow phone (measure:thread, the "feel alive" pass).
const CLOCK = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" });
const clock = (iso: string) => CLOCK.format(new Date(iso));

// One message. Memoised: sending or receiving one message renders that bubble, not all
// fifty — the merge functions keep an unchanged message the same object, and the handlers
// it gets are stable. Without this, the press and entrance wrappers made every Send ~20 ms
// slower to reach the screen on the mobile profile.
const Bubble = memo(function Bubble({
  m,
  mine,
  who,
  animate,
  holdable,
  onTakeBack,
  onLongPress,
}: {
  m: ThreadMessage;
  mine: boolean;
  who: string;
  animate: boolean;
  holdable: boolean;
  onTakeBack: (localId: string) => void;
  onLongPress: (m: ThreadMessage) => void;
}) {
  const failed = m.status === "failed";
  const meta = m.status === "sending" ? `You · ${THREAD_COPY.sending}` : failed ? THREAD_COPY.notSent : `${who} · ${clock(m.createdAt)}`;
  return (
    <Arrive fromRight={mine} animate={animate}>
      <Tap
        accessibilityRole={failed ? "button" : undefined}
        onPress={failed ? () => onTakeBack(m.id) : undefined}
        onLongPress={!m.status && holdable ? () => onLongPress(m) : undefined}
        style={[styles.bubble, mine ? styles.mine : styles.theirs, m.status === "sending" && styles.sending, failed && styles.failed]}
      >
        <Text style={[styles.who, failed && styles.failedText]}>{meta}</Text>
        <Text style={styles.body}>{m.body}</Text>
      </Tap>
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
}: {
  messages: ThreadMessage[];
  meId: string;
  nameOf: (authorId: string) => string;
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
        return (
          <Bubble
            key={m.id}
            m={m}
            mine={mine}
            who={mine ? "You" : nameOf(m.authorId)}
            animate={arrives(m, i)}
            holdable={!!onLongPress}
            onTakeBack={takeBack}
            onLongPress={hold}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: spacing.md, gap: spacing.sm },
  bubble: { padding: spacing.sm, borderRadius: radius.md, maxWidth: "88%" },
  mine: { alignSelf: "flex-end", backgroundColor: palette.accent },
  theirs: { alignSelf: "flex-start", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  sending: { opacity: 0.7 },
  failed: { backgroundColor: palette.surface, borderWidth: 1, borderColor: "#E06B6B" },
  who: { fontSize: 12, color: palette.textMuted, marginBottom: 2 },
  failedText: { color: "#F3B4B4" },
  body: { fontSize: 15, color: palette.text },
});
