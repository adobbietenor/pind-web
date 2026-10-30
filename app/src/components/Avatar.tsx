// A person's face, or their first letter when there is no photo to show (UI pass 1: the
// room card, the open-to-meeting list, the room's faces row, chat bubbles). Round, any size.
import { Image, type ImageSource } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts } from "@pind/shared";

export function Avatar({
  name,
  source,
  size,
  ring,
}: {
  name: string;
  source: ImageSource | string | null | undefined;
  size: number;
  // Outlined, for the people who have said something lately (the faces row).
  ring?: boolean;
}) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  const outline = ring ? { borderWidth: 2, borderColor: palette.accentText } : { borderWidth: 2, borderColor: palette.background };
  return source ? (
    <Image source={typeof source === "string" ? { uri: source } : source} style={[box, outline]} accessibilityLabel={name} />
  ) : (
    <View style={[box, outline, styles.empty]} accessibilityLabel={name}>
      <Text style={[styles.letter, { fontSize: Math.round(size * 0.42) }]}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

// Overlapping faces, then "+N" when there are more than fit.
export function AvatarStack({ people, size, max = 4 }: { people: { id: string; name: string; source: ImageSource | string | null | undefined }[]; size: number; max?: number }) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i ? -size * 0.28 : 0 }}>
          <Avatar name={p.name} source={p.source} size={size} />
        </View>
      ))}
      {more > 0 ? (
        <View style={[styles.more, { width: size, height: size, borderRadius: size / 2, marginLeft: -size * 0.28 }]}>
          <Text style={[styles.moreLabel, { fontSize: Math.round(size * 0.36) }]}>{`+${more}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { backgroundColor: "#3A2E4A", alignItems: "center", justifyContent: "center" },
  letter: { fontFamily: fonts.headline, color: palette.text },
  more: { backgroundColor: "#241B30", borderWidth: 2, borderColor: palette.background, alignItems: "center", justifyContent: "center" },
  moreLabel: { fontFamily: fonts.headline, color: palette.text },
});
