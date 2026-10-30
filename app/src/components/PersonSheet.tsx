// Tapping a person anywhere opens this sheet (UI pass 1, 075): their photo, first name,
// area and conversation starters, and "Say hi in the room". It shows exactly what the row
// that was tapped already holds, read through RLS by the screen that drew the row, so it
// adds no visibility (H3, H11).
//
// **Not here yet, and why:** "Let's meet up 1-on-1" waits on the 1-on-1 change (UI pass 1,
// behaviour A); Report and Block wait on A24, as on A22 (A24_EXISTS there). Until then the
// sheet links to the full profile, where A24's ⋯ will be.
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ImageSource } from "expo-image";
import { colors as palette, fonts, radius, spacing } from "@pind/shared";
import { Avatar } from "./Avatar";
import { Tap } from "./Tap";

export interface SheetPerson {
  id: string;
  firstName: string;
  photo: ImageSource | string | null | undefined;
  area: string | null;
  tags: string[];
}

export function PersonSheet({
  person,
  onClose,
  onSayHi,
  onProfile,
}: {
  person: SheetPerson | null;
  onClose: () => void;
  onSayHi?: () => void;
  onProfile: () => void;
}) {
  return (
    <Modal visible={!!person} transparent animationType="fade" onRequestClose={onClose}>
      <Tap accessibilityLabel="Close" style={styles.scrim} onPress={onClose}>
        <View />
      </Tap>
      {person ? (
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={{ alignItems: "center", gap: spacing.sm }}>
            <Avatar name={person.firstName} source={person.photo} size={112} />
            <Text style={styles.name}>{person.firstName}</Text>
            {person.area ? <Text style={styles.area}>{person.area}</Text> : null}
            {person.tags.length ? (
              <View style={styles.tags}>
                {person.tags.map((t) => (
                  <View key={t} style={styles.tag}>
                    <Text style={styles.tagLabel}>{t}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={{ alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.sm }}>
              {onSayHi ? (
                <Tap accessibilityRole="button" onPress={onSayHi} style={styles.primary}>
                  <Text style={styles.primaryLabel}>Say hi in the room</Text>
                </Tap>
              ) : null}
              <Tap accessibilityRole="button" onPress={onProfile} style={styles.quiet}>
                <Text style={styles.quietLabel}>See their profile</Text>
              </Tap>
            </View>
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "85%",
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
  },
  name: { fontFamily: fonts.headline, fontSize: 24, color: palette.text, marginTop: spacing.xs },
  area: { fontSize: 15, color: palette.textMuted },
  tags: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xs },
  tag: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  tagLabel: { fontSize: 14, color: palette.text },
  primary: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: palette.accent },
  primaryLabel: { fontFamily: fonts.headline, fontSize: 16, color: palette.onAccent },
  quiet: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: palette.border },
  quietLabel: { fontFamily: fonts.headline, fontSize: 15, color: palette.text },
});
