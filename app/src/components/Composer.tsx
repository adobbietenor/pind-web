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
import { Platform, StyleSheet, Text, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from "react-native";
import { colors as palette, radius, spacing, THREAD_COPY } from "@pind/shared";
import { haptic } from "@/lib/motion";
import { useScrollToEnd } from "./AppScreen";
import { Button } from "./ui";

const LINE = 21;
const PAD = 12;
const MIN = 52;
// About five lines, then the box scrolls.
const MAX = LINE * 5 + PAD * 2 + 2;

export function Composer({
  value,
  onChangeText,
  onSend,
  placeholder,
  note,
  ready = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  // A refusal of the last send ("one message every few seconds") — said here, where the tap was.
  note?: string;
  // False until the thread has loaded: nothing to send into yet.
  ready?: boolean;
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
      <View style={styles.row}>
        <TextInput
          ref={box}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.tabInactive}
          maxLength={500}
          multiline
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
        <View style={styles.send}>
          <Button label={THREAD_COPY.send} disabled={!can} onPress={submit} />
        </View>
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
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
    paddingTop: PAD,
    paddingBottom: PAD,
    color: palette.text,
    backgroundColor: palette.surface,
    fontSize: 16,
    lineHeight: LINE,
    textAlignVertical: "top",
  },
  send: { width: 88 },
  note: { fontSize: 14, lineHeight: 19, color: "#F3B4B4", marginBottom: spacing.xs + 2 },
});
