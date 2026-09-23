// A1's two brand buttons — Apple and Google — drawn as one pair (Alex, M3.1: "they
// look like two different products stacked").
//
// **Every number here is one of the two brands' rules, or the place they meet.**
// Sources and the reasoning are in decisions.md, "Apple and Google as one pair".
//
//   - One geometry for both: 44 high with a 1 px stroke, so the button inside the
//     stroke is 42 — Apple's default height, and the height its logo file matches.
//   - Title 18 px in the system font: Apple's proportion (title = 43% of the button,
//     "regardless of the font you choose"). Google's own is 35%; Apple's is the one
//     stated as a rule, so both buttons use it and the titles match.
//   - Apple's mark is Apple's own file (Left-aligned, Medium), height = button height,
//     never cropped. Google's G is Google's own, at half the button's height with
//     Google's left padding (12 of 40), and the Apple file is inset so the two marks
//     share one centre line — Apple allows exactly that ("inset the logo… to align
//     with other authentication logos").
//   - Logo and title both black or both white on Apple (Apple's rule); the G is always
//     full colour, on a dark or white fill only (Google's rule).
//
// In the app, Apple is Apple's own system button (AppleAuthenticationButton), which
// sizes its own title; this component draws the web's Apple button and Google's
// everywhere.
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

export type ButtonLook = "matched" | "outline";
export type Provider = "apple" | "google";

export const BUTTON_HEIGHT = 44;
const STROKE = 1;
const INNER = BUTTON_HEIGHT - 2 * STROKE; // 42
const TITLE = Math.round(INNER * 0.43); // 18
export const BUTTON_RADIUS = 12;

// Google: the G is half the button's height, 12/40 of the height in from the edge.
const G_SIZE = INNER / 2;
const G_LEFT = (12 / 40) * INNER;
const MARK_CENTRE = G_LEFT + G_SIZE / 2;
// Apple's Medium file is 31 × 44 with the glyph centred at x = 15.5.
const APPLE_W = (31 / 44) * INNER;
const APPLE_LEFT = MARK_CENTRE - (15.5 / 44) * INNER;

const APPLE_BLACK_LOGO = require("../../assets/signin/apple-logo-black-medium.svg");
const APPLE_WHITE_LOGO = require("../../assets/signin/apple-logo-white-medium.svg");
const GOOGLE_G = require("../../assets/signin/google-g.png");

// Google's dark theme, from its guidelines: fill #131314, stroke #8E918F, text #E3E3E3.
const GOOGLE_STROKE = "#8E918F";

interface Colours {
  fill: string;
  stroke: string;
  title: string;
  logo?: number;
}

export function lookFor(provider: Provider, look: ButtonLook): Colours {
  if (provider === "apple") {
    return look === "matched"
      ? // Apple's white style, for dark backgrounds.
        { fill: "#FFFFFF", stroke: "#FFFFFF", title: "#000000", logo: APPLE_BLACK_LOGO }
      : // Apple's black, with a stroke to emphasise the bezel — both allowed on a
        // custom button. The fill is true black because the logo file's own
        // background is.
        { fill: "#000000", stroke: GOOGLE_STROKE, title: "#FFFFFF", logo: APPLE_WHITE_LOGO };
  }
  return look === "matched"
    ? { fill: "#131314", stroke: GOOGLE_STROKE, title: "#E3E3E3" }
    : // Same stroke, black fill (a dark background, which the G allows) and a white
      // title so the pair reads as one.
      { fill: "#000000", stroke: GOOGLE_STROKE, title: "#FFFFFF" };
}

export function SignInButton({
  provider,
  look,
  onPress,
  busy,
}: {
  provider: Provider;
  look: ButtonLook;
  onPress: () => void;
  busy: boolean;
}) {
  const c = lookFor(provider, look);
  const title = provider === "apple" ? "Continue with Apple" : "Continue with Google";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy }}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: c.fill, borderColor: c.stroke },
        pressed && !busy && { opacity: 0.85 },
      ]}
    >
      {provider === "apple" ? (
        <Image source={c.logo} style={[styles.apple]} contentFit="fill" accessible={false} />
      ) : (
        <Image source={GOOGLE_G} style={styles.g} contentFit="contain" accessible={false} />
      )}
      {busy ? (
        <ActivityIndicator color={c.title} />
      ) : (
        <Text style={[styles.title, { color: c.title }]} numberOfLines={1}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

// The native Apple button inside the same stroke, so the app's pair matches too.
export function NativeAppleFrame({ look, children }: { look: ButtonLook; children: React.ReactNode }) {
  const c = lookFor("apple", look);
  return <View style={[styles.frame, { borderColor: c.stroke, backgroundColor: c.fill }]}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    height: BUTTON_HEIGHT,
    borderWidth: STROKE,
    borderRadius: BUTTON_RADIUS,
    alignItems: "center",
    justifyContent: "center",
    // The title is centred across the whole button; the padding keeps it clear of
    // the mark, and is more than Apple's 8% minimum from the trailing edge.
    paddingHorizontal: MARK_CENTRE * 2 + 4,
    overflow: "hidden",
  },
  apple: { position: "absolute", left: APPLE_LEFT, top: 0, width: APPLE_W, height: INNER },
  g: { position: "absolute", left: G_LEFT, top: (INNER - G_SIZE) / 2, width: G_SIZE, height: G_SIZE },
  title: { fontSize: TITLE, fontWeight: "500", letterSpacing: 0 },
  frame: {
    height: BUTTON_HEIGHT,
    borderWidth: STROKE,
    borderRadius: BUTTON_RADIUS,
    overflow: "hidden",
  },
});
