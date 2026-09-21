import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { spacing } from "@pind/shared";

// The mark and the wordmark, the same lockup the public pages carry (W1–W4).
//
// **Generated, not drawn.** `app/assets/lockup.png` comes from `npm run brand:app`,
// which rasterises the same paths `src/public/brand.ts` inlines — so the app and the
// Worker cannot drift into two logos. It is a PNG because React Native cannot draw an
// SVG without a dependency, and `expo-image` was already here.
//
// The app never had it: M2.1 gave the Worker's pages the brand and the Expo shell kept
// the placeholder text it was born with, which nothing connected.
export function Brand({ height = 22 }: { height?: number }) {
  // 214.22 × 78.88 is the lockup's own aspect (src/public/brand.ts).
  const width = (214.22 / 78.88) * height;
  return (
    <View style={styles.row}>
      <Image
        source={require("../../assets/lockup.png")}
        style={{ width, height }}
        contentFit="contain"
        accessibilityLabel="Pin'd"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
});
