import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
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
//
// **The header is the way home, on every screen that has one** (#1, Alex, 14 Oct 2026:
// one rule, not a fix per screen). After a pin, after the night, anywhere: the logo opens
// the app's home, Crowds. The Worker's header has always been this (`header()`: one
// anchor spanning it, to W1), so the two halves now behave alike. One control for the
// whole row, with one name, as on the public pages — not two links to the same place.
// Two ways there, because there are two shapes underneath (both walked in check:home):
// above the tabs with the tabs below, it steps back to them (`dismissTo`), so home is
// never pushed on top of itself; from a tab, or a page opened cold from a link, there is
// nothing to step back through and `dismissTo` does nothing, so it goes there instead.
export function Brand() {
  return (
    <Pressable
      style={styles.row}
      accessibilityRole="link"
      accessibilityLabel="Pin'd — home"
      onPress={() => (router.canDismiss() ? router.dismissTo("/crowds") : router.navigate("/crowds"))}
    >
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // space-between, so the two ends of the row are the two pieces — exactly the
  // public header's rule, and the reason the city label can sit between them later.
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
});
