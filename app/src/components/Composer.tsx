// The box every thread writes in — the room (A10), a squad (A11), a 1-on-1 plan (A29) —
// drawn once, here, and passed to AppScreen as its footer (the thread pass, 16 Oct 2026).
//
//   * Enter sends. On the web and with a hardware keyboard, Enter sends and Shift+Enter
//     makes a new line; a word still being composed (an IME, a dictation) is never sent
//     half-made. On the iPhone's own keyboard the return key reads "Send" and sends.
//     **iOS cannot tell Shift+Enter from Enter** (React Native's text input reports no
//     modifier keys), so in the app Return always sends, from either keyboard, and a new
//     line is not typed — a long message wraps instead.
//   * The Send button stays, for everyone. Enter and the button are the same act: both
//     call `onSend`, which is the screen's own send (S29 — nothing is sent for anyone).
//   * The box grows with what you type, to about five lines, then scrolls inside itself.
//     iOS grows a multiline input by itself; the web's textarea does not, so on the web
//     the box is measured on every change, shrinking included.
//   * Focusing the box or sending brings the conversation to its newest message.
import { useLayoutEffect, useRef } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from "react-native";
import { colors as palette, radius, spacing, THREAD_COPY } from "@pind/shared";
import { haptic } from "@/lib/motion";
import { useScrollToEnd } from "./AppScreen";
import { Icon } from "./Icon";
import { Tap } from "./Tap";

// **The field and Send share a centre line and a height** (UI pass 1, 057): one line of
// text sits vertically centred in a 48-point pill, the round Send beside it is 48 too, and
// the row aligns to its bottom, so as the field grows upward Send stays where the thumb is.
const LINE = 21;
const MIN = 48;
const PAD = (MIN - 2 - LINE) / 2;
// About five lines, then the box scrolls.
const MAX = LINE * 5 + PAD * 2 + 2;

export function Composer({
  value,
  onChangeText,
  onSend,
  placeholder,
  note,
  ready = true,
  chips,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  // A refusal of the last send ("one message every few seconds") — said here, where the tap was.
  note?: string;
  // False until the thread has loaded: nothing to send into yet.
  ready?: boolean;
  // Lines that fill the box when tapped, in a row just above it (the room's openers).
  // They never send: S29.
  chips?: readonly string[];
}) {
  const toEnd = useScrollToEnd();
  const box = useRef<TextInput>(null);
  const can = ready && !!value.trim();

  // The Send button and the keyboard's Send key both come here: one haptic, either way.
  const submit = () => {
    if (!can) return;
    onSend();
    haptic("action");
    toEnd();
  };

  // The web's textarea: as tall as its words, between MIN and MAX.
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const el = box.current as unknown as HTMLTextAreaElement | null;
    if (!el?.style) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(MAX, Math.max(MIN, el.scrollHeight + 2))}px`;
  }, [value]);

  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = e.nativeEvent as unknown as KeyboardEvent;
    if (key.key !== "Enter" || key.shiftKey || key.isComposing || key.keyCode === 229) return;
    e.preventDefault();
    submit();
  };

  return (
    <View>
      {note ? (
        <Text accessibilityRole="alert" style={styles.note}>
          {note}
        </Text>
      ) : null}
      {chips?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {chips.map((c) => (
            <Tap key={c} accessibilityRole="button" haptic="select" onPress={() => onChangeText(c)} style={styles.chip}>
              <Text style={styles.chipText}>{c}</Text>
            </Tap>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.row}>
        <TextInput
          ref={box}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.tabInactive}
          maxLength={500}
          multiline
          // One row to start: the web textarea otherwise opens two rows tall, off the Send
          // button's centre line; the effect above grows it as the text does.
          numberOfLines={1}
          scrollEnabled
          style={styles.input}
          enterKeyHint="send"
          // iOS: the return key sends and the keyboard stays up for the next message.
          submitBehavior="submit"
          onSubmitEditing={Platform.OS === "web" ? undefined : submit}
          // The web: Enter sends, Shift+Enter is a new line.
          onKeyPress={Platform.OS === "web" ? onKeyPress : undefined}
          onFocus={toEnd}
        />
        <Tap accessibilityRole="button" accessibilityLabel={THREAD_COPY.send} accessibilityState={{ disabled: !can }} disabled={!can} onPress={submit} style={[styles.send, !can && styles.sendOff]}>
          <Icon name="arrowRight" size={22} color={palette.onAccent} />
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: MIN,
    maxHeight: MAX,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: MIN / 2,
    paddingHorizontal: spacing.md,
    paddingTop: PAD,
    paddingBottom: PAD,
    color: palette.text,
    backgroundColor: palette.surface,
    fontSize: 16,
    lineHeight: LINE,
    textAlignVertical: "center",
  },
  send: { width: MIN, height: MIN, borderRadius: MIN / 2, alignItems: "center", justifyContent: "center", backgroundColor: palette.accent },
  sendOff: { opacity: 0.45 },
  chips: { gap: spacing.sm, paddingBottom: spacing.sm },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderWidth: 1, borderColor: palette.accent, borderRadius: 999 },
  chipText: { fontSize: 14, color: palette.text },
  note: { fontSize: 14, lineHeight: 19, color: "#F3B4B4", marginBottom: spacing.xs + 2 },
});
