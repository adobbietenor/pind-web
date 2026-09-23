// The tag picker, shared by A3 (onboarding) and Profile → Edit (M3.1).
//
// **One component, because it is one control.** A3 asks for it the first time and the
// profile edits it afterwards, and two copies of a picker with two caps and two
// "which three show" rules is two places for them to drift.
//
// **Three rules it has to make visible rather than merely obey:**
//   * at least three — asked here, never in the database (the link path pins with none);
//   * up to ten — the database's rule; the tap that reaches ten says so, and an
//     eleventh says why it did nothing. A cap that silently ignores a tap reads as
//     broken;
//   * three of them show on the "going & open to meeting" row, and the person picks
//     which. Everything else still shows on the profile behind it, so this chooses a
//     headline, not an audience.
//
// **The note appears under the chips that were tapped** (Alex, M3.1, walking A3). It
// used to be handed up to the screen, which showed it above all 32 chips — off-screen
// from a tap near the bottom, so the eleventh tap looked like nothing at all. The
// refusal was produced (T03 proved it) and never seen.
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ALL_TAGS,
  colors as palette,
  countOnList,
  fonts,
  radius,
  spacing,
  TAGS,
  TAGS_MINIMUM,
  TAGS_ON_LIST,
  toggleOnList,
  toggleTag,
  type PickedTag,
} from "@pind/shared";
import { Body } from "./ui";

// The caps and their sentences live in `@pind/shared` so they can be tested under
// bare node — a rule whose job is to refuse something is proved by a test that
// makes it refuse, and this one could not be loaded where it was.
export type { PickedTag as Picked } from "@pind/shared";
export { countOnList, enoughPicked, tagsCanContinue } from "@pind/shared";

export function TagPicker({
  picked,
  onChange,
}: {
  picked: PickedTag[];
  onChange: (next: PickedTag[]) => void;
}) {
  // What the last tap said, and where: the name of the group it was in, or "list".
  const [note, setNote] = useState<{ says: string; at: string } | null>(null);
  const apply = (result: { next: PickedTag[]; says?: string }, at: string) => {
    setNote(result.says ? { says: result.says, at } : null);
    onChange(result.next);
  };
  const noteAt = (at: string) =>
    note?.at === at ? (
      <View style={styles.note} accessibilityLiveRegion="polite">
        <Text style={styles.noteText}>{note.says}</Text>
      </View>
    ) : null;

  const chosen = picked.map((p) => p.slug);

  return (
    <View>
      {TAGS.map((group) => (
        <View key={group.group} style={{ marginBottom: spacing.md }}>
          <Text style={styles.groupName}>{group.group}</Text>
          <View style={styles.chips}>
            {group.tags.map((t) => {
              const on = chosen.includes(t.slug);
              return (
                <Pressable
                  key={t.slug}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => apply(toggleTag(picked, t.slug), group.group)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipLabel, on && { color: palette.onAccent }]}>{t.name}</Text>
                </Pressable>
              );
            })}
          </View>
          {noteAt(group.group)}
        </View>
      ))}

      {picked.length > 0 ? (
        <View style={styles.listBox}>
          <Text style={styles.groupName}>Which three show on the list</Text>
          <View style={{ marginBottom: spacing.sm }}>
            <Body muted>
              Everyone going sees these three next to your name. The rest are on your profile when somebody taps in.
            </Body>
          </View>
          <View style={styles.chips}>
            {picked.map((p) => {
              const name = ALL_TAGS.find((t) => t.slug === p.slug)?.name ?? p.slug;
              return (
                <Pressable
                  key={p.slug}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: p.onList }}
                  onPress={() => apply(toggleOnList(picked, p.slug), "list")}
                  style={[styles.chip, p.onList && styles.chipOn, !p.onList && { opacity: 0.55 }]}
                >
                  <Text style={[styles.chipLabel, p.onList && { color: palette.onAccent }]}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
          {noteAt("list")}
        </View>
      ) : null}

      <View style={{ marginTop: spacing.sm }}>
        <Body muted>
          {picked.length < TAGS_MINIMUM
            ? `${picked.length} of ${TAGS_MINIMUM} — pick a few more.`
            : `${picked.length} picked, ${countOnList(picked)} on the list.`}
        </Body>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  groupName: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginBottom: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipLabel: { fontSize: 15, color: palette.text },
  note: {
    marginTop: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: palette.accentText,
    paddingLeft: spacing.sm,
    paddingVertical: 4,
  },
  noteText: { fontSize: 14, lineHeight: 20, color: palette.textTint },
  listBox: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
  },
});
