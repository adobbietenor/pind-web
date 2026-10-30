// W2's "Details" toggle in the app (UI pass 1, 005): closed by default, holding the address,
// what it is, and the way out to whoever is putting it on. The same words and the same
// link rule as W2 (CROWD_PAGE_COPY; the facts endpoint's `link`, from W2's outLink).
import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { colors as palette, CROWD_PAGE_COPY, fonts, radius, spacing } from "@pind/shared";
import { Icon } from "./Icon";
import { Tap } from "./Tap";

export function CrowdDetails({
  address,
  blurb,
  why,
  link,
}: {
  address: string | null;
  blurb: string | null;
  why: string | null;
  link: { href: string; label: string } | null;
}) {
  const [open, setOpen] = useState(false);
  if (!address && !blurb && !why && !link) return null;
  const toggle = (
    <Tap accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.pill}>
      <Text style={styles.pillLabel}>{open ? CROWD_PAGE_COPY.hideDetails : CROWD_PAGE_COPY.details}</Text>
      <View style={open ? { transform: [{ rotate: "180deg" }] } : undefined}>
        <Icon name="chevronDown" size={16} color={palette.text} />
      </View>
    </Tap>
  );
  if (!open) return <View style={styles.wrap}>{toggle}</View>;
  return (
    <View style={[styles.wrap, styles.card]}>
      {toggle}
      {address ? <Text style={styles.address}>{address}</Text> : null}
      {blurb ? <Text style={styles.blurb}>{blurb}</Text> : null}
      {why ? <Text style={styles.why}>{why}</Text> : null}
      {link ? (
        <Text accessibilityRole="link" onPress={() => void Linking.openURL(link.href)} style={styles.link}>
          {`${link.label} →`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, alignItems: "flex-start", gap: spacing.sm + 2 },
  card: { alignItems: "stretch", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: "#2A2830", backgroundColor: "#141318" },
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 22, borderWidth: 1, borderColor: "#34303D", backgroundColor: "#1A1820" },
  pillLabel: { fontSize: 15, color: palette.text },
  address: { fontSize: 15, color: palette.textMuted },
  blurb: { fontSize: 16, lineHeight: 22, color: palette.text },
  why: { fontSize: 15, lineHeight: 21, color: palette.textMuted },
  link: { fontSize: 15, color: palette.accentText, textDecorationLine: "underline" },
});
