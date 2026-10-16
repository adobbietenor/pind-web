// What a long-press on a message offers — in the room (A10), a squad (A11) and a 1-on-1
// plan (A29) alike, drawn once here so no thread can offer something the others don't.
//
//   * your own message: delete it, where the thread allows deleting (the room — L9: a
//     removal, gone for everyone). A group's thread has no delete.
//   * anyone else's: "Report <name>" and the four reasons (H9) — a report on the PERSON,
//     never on the message (Alex, 16 Oct 2026). Two taps from any message: hold, then a reason.
import { StyleSheet, View } from "react-native";
import { colors as palette, radius, REPORT_REASONS, ROOM_COPY, spacing, type ThreadMessage } from "@pind/shared";
import type { ReportReason } from "@/lib/room";
import { Body, Button } from "./ui";

export function MessageSheet({
  held,
  mine,
  authorName,
  onDelete,
  onReport,
  onCancel,
}: {
  held: ThreadMessage;
  mine: boolean;
  authorName: string;
  // Only where the thread allows deleting your own message.
  onDelete?: () => void;
  onReport: (reason: ReportReason) => void;
  onCancel: () => void;
}) {
  if (mine && !onDelete) return null;
  return (
    <View style={styles.sheet} key={held.id}>
      {mine ? (
        <>
          <Body>{ROOM_COPY.deleteOwn}</Body>
          <Button label="Delete" onPress={() => onDelete?.()} />
        </>
      ) : (
        <>
          <Body>{ROOM_COPY.reportPerson(authorName)}</Body>
          <Body muted>{ROOM_COPY.reportHint}</Body>
          {REPORT_REASONS.map((r) => (
            <Button key={r.value} kind="quiet" label={r.label} onPress={() => onReport(r.value)} />
          ))}
        </>
      )}
      <Button kind="quiet" label="Cancel" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, marginTop: spacing.md, gap: spacing.sm },
});
