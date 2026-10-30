// An empty tab that explains itself (UI pass 1, 049 A19 and 050 A20): an icon, a heading,
// what will appear here and how, optional numbered steps, and the one way forward.
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, radius, spacing, type IconName } from "@pind/shared";
import { Icon } from "./Icon";
import { Tap } from "./Tap";

// A line with **bold** spans, the only markup the copy uses.
function Rich({ text, style }: { text: string; style: object }) {
  return (
    <Text style={style}>
      {text.split("**").map((part, i) => (i % 2 ? <Text key={i} style={styles.bold}>{part}</Text> : part))}
    </Text>
  );
}

export function EmptyCard({
  icon,
  heading,
  line,
  steps,
  button,
  onPress,
  buttonInside = true,
}: {
  icon: IconName;
  heading: string;
  line: string;
  steps?: { heading: string; items: readonly string[] };
  button: string;
  onPress: () => void;
  buttonInside?: boolean;
}) {
  const cta = (
    <Tap accessibilityRole="button" onPress={onPress} style={styles.button}>
      <Text style={styles.buttonLabel}>{button}</Text>
    </Tap>
  );
  return (
    <View style={{ marginTop: spacing.md, gap: spacing.md }}>
      <View style={styles.card}>
        <View style={styles.badge}>
          <Icon name={icon} size={22} color={palette.accentText} />
        </View>
        <Text style={styles.heading}>{heading}</Text>
        <Rich text={line} style={styles.line} />
        {steps ? (
          <View style={{ gap: spacing.sm + 2, marginTop: spacing.xs }}>
            <Text style={styles.stepsHeading}>{steps.heading}</Text>
            {steps.items.map((s, i) => (
              <View key={s} style={styles.step}>
                <View style={styles.num}>
                  <Text style={styles.numLabel}>{i + 1}</Text>
                </View>
                <Rich text={s} style={[styles.line, { flex: 1 }]} />
              </View>
            ))}
          </View>
        ) : null}
        {buttonInside ? cta : null}
      </View>
      {buttonInside ? null : cta}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md + 4, gap: spacing.sm + 2, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, backgroundColor: palette.surface },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#2A2236" },
  heading: { fontFamily: fonts.headline, fontSize: 21, lineHeight: 27, color: palette.text },
  line: { fontSize: 15, lineHeight: 22, color: palette.textMuted },
  bold: { fontFamily: fonts.headline, color: palette.text },
  stepsHeading: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted },
  step: { flexDirection: "row", gap: spacing.sm + 2, alignItems: "flex-start" },
  num: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.accent, marginTop: 1 },
  numLabel: { fontFamily: fonts.headline, fontSize: 13, color: palette.onAccent },
  button: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: palette.accent, marginTop: spacing.xs },
  buttonLabel: { fontFamily: fonts.headline, fontSize: 16, color: palette.onAccent },
});
