// A dropdown that opens a list in a sheet (UI pass 1, 024: the date of birth as Month /
// Day / Year). Built from React Native's own Modal and ScrollView, so the web and iOS get
// the same control with no new dependency; a native iOS wheel would need one, which is
// Alex's call (CLAUDE.md, "Expo rules").
import { Image } from "expo-image";
import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors as palette, iconUri, radius, spacing } from "@pind/shared";
import { Tap } from "./Tap";

export interface SelectOption<T> {
  value: T;
  name: string;
}

export function Select<T extends string | number>({
  label,
  placeholder,
  options,
  value,
  onChange,
  flex = 1,
}: {
  label: string;
  placeholder: string;
  options: readonly SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  flex?: number;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  return (
    <View style={{ flex }}>
      <Tap
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen ? chosen.name : "not chosen"}`}
        onPress={() => setOpen(true)}
        style={styles.box}
      >
        <Text style={[styles.value, !chosen && { color: palette.tabInactive }]} numberOfLines={1}>
          {chosen ? chosen.name : placeholder}
        </Text>
        <Image source={{ uri: iconUri("chevronDown", 16, palette.text) }} style={{ width: 16, height: 16 }} />
      </Tap>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Tap accessibilityLabel="Close" style={styles.scrim} onPress={() => setOpen(false)}>
          <View />
        </Tap>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{label}</Text>
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
            {options.map((o) => {
              const on = o.value === value;
              return (
                <Tap
                  key={String(o.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={[styles.row, on && styles.rowOn]}
                >
                  <Text style={[styles.rowLabel, on && { color: palette.onAccent }]}>{o.name}</Text>
                </Tap>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  value: { flexShrink: 1, fontSize: 16, color: palette.text },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxWidth: 520,
    alignSelf: "center",
    width: "100%",
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
  },
  sheetTitle: { fontSize: 14, color: palette.textMuted, marginBottom: spacing.sm },
  row: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.sm },
  rowOn: { backgroundColor: palette.accent },
  rowLabel: { fontSize: 17, color: palette.text },
});
