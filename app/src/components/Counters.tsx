// The crowd's two numbers, stacked, each with its icon (UI pass 1, rule 5): person "37
// going", handshake "14 open to meeting" or "Nobody open to meeting yet". The words are
// COUNTERS from packages/shared, which W2 draws too, so the two halves cannot part. A
// third line ("N here now") arrives with the night's layout (088).
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, COUNTERS, fonts, spacing, type IconName } from "@pind/shared";
import { Icon } from "./Icon";

export function Counters({ going, open, extra }: { going: number; open: number; extra?: { icon: IconName; line: string }[] }) {
  if (going === 0) return <Text style={styles.nobody}>{COUNTERS.nobody}</Text>;
  const lines: { icon: IconName; line: string }[] = [
    { icon: "person", line: COUNTERS.going(going) },
    { icon: "handshake", line: COUNTERS.open(open) },
    ...(extra ?? []),
  ];
  return (
    <View style={styles.box}>
      {lines.map((l) => (
        <View key={l.icon + l.line} style={styles.line}>
          <Icon name={l.icon} size={22} color={palette.accentText} />
          <Text style={styles.text}>{l.line}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm + 2 },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4 },
  text: { fontFamily: fonts.headline, fontSize: 20, color: palette.text },
  nobody: { fontFamily: fonts.headline, fontSize: 20, color: palette.text },
});
