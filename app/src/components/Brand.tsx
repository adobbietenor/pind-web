import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { MARK, WORDMARK } from "@pind/shared";

// **The mark at one end of the row and the wordmark at the other** — the same header
// the public pages carry (`src/public/layout.ts`: "the mark at one end, the wordmark
// at the other, and nothing else competing with either").
//
// M3.1 first shipped this as the composed LOCKUP, which is the **OG image's** layout:
// the two pieces together in the middle of a picture. In a header that puts both logos
// in the corner and leaves the rest of the row empty. They are two pieces here, spread
// across the width, which is what makes it a header rather than a badge.
//
// **Generated, not drawn.** `npm run brand:app` rasterises the same paths
// `src/public/brand.ts` inlines, so the app and the Worker cannot drift into two
// logos. PNG because React Native cannot draw an SVG without a dependency, and
// `expo-image` was already here.
export function Brand() {
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="Pin'd">
      <Image
        source={require("../../assets/mark.png")}
        style={{ width: (MARK.width / MARK.height) * 24, height: 24 }}
        contentFit="contain"
      />
      <Image
        source={require("../../assets/wordmark.png")}
        style={{ width: (WORDMARK.width / WORDMARK.height) * 19, height: 19 }}
        contentFit="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // space-between, so the two ends of the row are the two pieces — exactly the
  // public header's rule, and the reason the city label can sit between them later.
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
});
