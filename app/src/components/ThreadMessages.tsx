// The messages of a thread — the room (A10), a squad (A11), a 1-on-1 plan (A29) — drawn
// once, so a state a message can be in looks the same in all three (the thread pass,
// 16 Oct 2026).
//
//   * "Earlier messages" at the top when there is history not yet read: a page at a time.
//   * One of mine still in flight reads "Sending…"; one the database refused, or that
//     never got an answer, reads "Not sent — tap to put it back in the box". The tap
//     returns its words to the box and nothing else: it is never sent again for you (S29).
//   * Long-press is the screen's (the room: delete your own, report anyone else's, H9).
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors as palette, radius, spacing, THREAD_COPY, type ThreadMessage } from "@pind/shared";
import { Button } from "./ui";

const clock = (iso: string) => new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));

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
  return (
    <View style={styles.list}>
      {hasOlder ? <Button kind="quiet" label={THREAD_COPY.earlier} busy={olderBusy} onPress={onOlder} /> : null}
      {messages.map((m) => {
        const mine = m.authorId === meId;
        const failed = m.status === "failed";
        const meta = m.status === "sending" ? `You · ${THREAD_COPY.sending}` : failed ? THREAD_COPY.notSent : `${mine ? "You" : nameOf(m.authorId)} · ${clock(m.createdAt)}`;
        return (
          <Pressable
            key={m.id}
            accessibilityRole={failed ? "button" : undefined}
            onPress={failed ? () => onTakeBack(m.id) : undefined}
            onLongPress={!m.status && onLongPress ? () => onLongPress(m) : undefined}
            style={[styles.bubble, mine ? styles.mine : styles.theirs, m.status === "sending" && styles.sending, failed && styles.failed]}
          >
            <Text style={[styles.who, failed && styles.failedText]}>{meta}</Text>
            <Text style={styles.body}>{m.body}</Text>
          </Pressable>
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
