// The neighbourhood, picked from the fixed list (A3, A27's "where", Profile →
// Neighbourhood). One control, drawn once (M3.2).
//
// "Pin'd never asks where you are" — a fixed list shown instead of a location, because
// there is no location permission to grant (H4). Tapping the chosen one again clears it.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors as palette, NEIGHBOURHOODS, radius, spacing } from "@pind/shared";

export function NeighbourhoodPicker({ value, onChange }: { value: string | null; onChange: (slug: string | null) => void }) {
  return (
    <View style={styles.hoods}>
      {NEIGHBOURHOODS.map((n) => {
        const on = n.slug === value;
        return (
          <Pressable
            key={n.slug}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(on ? null : n.slug)}
            style={[styles.hood, on && styles.hoodOn]}
          >
            <Text style={[styles.hoodLabel, on && { color: palette.onAccent }]}>{n.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  hoods: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  hood: {
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  hoodOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  hoodLabel: { fontSize: 15, color: palette.text },
});
