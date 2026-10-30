// **House rules is one collapsed row, closed by default, everywhere it appears** (UI pass
// 1, rule 2), with nothing under it. The rules themselves are HOUSE_RULES, verbatim.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, HOUSE_RULES, radius, spacing } from "@pind/shared";
import { Icon } from "./Icon";
import { Tap } from "./Tap";

export function HouseRules() {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.box}>
      <Tap accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.row}>
        <Text style={styles.label}>House rules</Text>
        <View style={open ? { transform: [{ rotate: "180deg" }] } : undefined}>
          <Icon name="chevronDown" size={16} color={palette.text} />
        </View>
      </Tap>
      {open ? (
        <View style={styles.rules}>
          {HOUSE_RULES.map((r, i) => (
            <Text key={r} style={styles.rule}>{`${i + 1}.  ${r}`}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md },
  label: { fontFamily: fonts.headline, fontSize: 15, color: palette.text },
  rules: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  rule: { fontSize: 15, lineHeight: 21, color: palette.text },
});
