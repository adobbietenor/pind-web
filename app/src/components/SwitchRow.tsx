// A meeting switch (UI pass 1, 073 and 106): an icon, what it is, one line of what it does,
// and the switch on the right. The whole row is the target, as Tick's is.
import { StyleSheet, Switch, Text, View } from "react-native";
import { colors as palette, fonts, radius, spacing, type IconName } from "@pind/shared";
import { Icon } from "./Icon";
import { Tap } from "./Tap";

export function SwitchRow({
  icon,
  label,
  line,
  value,
  onChange,
  disabled,
}: {
  icon: IconName;
  label: string;
  line?: string;
  value: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Tap
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={styles.row}
    >
      <Icon name={icon} size={20} color={palette.accentText} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.label}>{label}</Text>
        {line ? <Text style={styles.line}>{line}</Text> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: "#2E2B35", true: palette.accent }}
        thumbColor="#FFFFFF"
        // The web's Switch colours its thumb with this one (react-native-web).
        {...({ activeThumbColor: "#FFFFFF" } as object)}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Tap>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 4, padding: spacing.md, minHeight: 56, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface },
  label: { fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  line: { fontSize: 14, lineHeight: 19, color: palette.textMuted },
});
