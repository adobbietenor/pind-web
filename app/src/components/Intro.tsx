// The launch intro (UI pass 1, round 3, item 15): after the native splash, the Pin'd logo
// where the splash left it, then the tagline fades in beneath it, then the app. About two
// seconds in all, React Native's Animated only.
//
//   * Only on a cold start: `played` lives in the module, so coming back from the background
//     (the JS stays alive) never shows it again; a fresh launch loads the module fresh.
//   * iOS only: it follows the native splash, and the web has none. A visitor from a Reddit

//   * Under Reduce Motion (S46) nothing moves: logo and tagline are there at once, and the
//     intro cuts to the app at the same moment, never fading.
//   * The tagline is ONE_LINER from packages/shared, the line W1 shows under its heading.
//   * It sits over the app, which loads beneath it, so the intro never delays the first
//     screen.
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Platform, StyleSheet, Text } from "react-native";
import { colors as palette, fonts, ONE_LINER } from "@pind/shared";
import { EASE_OUT, NATIVE_DRIVER } from "@/lib/motion";

// The timeline, in ms (2,000 in all).
export const INTRO = { taglineAt: 450, taglineMs: 400, leaveAt: 1700, leaveMs: 300 } as const;

let played = false;

export function Intro() {
  const [show, setShow] = useState(() => Platform.OS === "ios" && !played);
  const tagline = useRef(new Animated.Value(0)).current;
  const all = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!show) return;
    played = true;
    let live = true;
    let run: Animated.CompositeAnimation | null = null;
    let cut: ReturnType<typeof setTimeout> | null = null;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (!live) return;
        if (reduce) {
          tagline.setValue(1);
          cut = setTimeout(() => setShow(false), INTRO.leaveAt + INTRO.leaveMs);
          return;
        }
        run = Animated.sequence([
          Animated.delay(INTRO.taglineAt),
          Animated.timing(tagline, { toValue: 1, duration: INTRO.taglineMs, easing: EASE_OUT, useNativeDriver: NATIVE_DRIVER }),
          Animated.delay(INTRO.leaveAt - INTRO.taglineAt - INTRO.taglineMs),
          Animated.timing(all, { toValue: 0, duration: INTRO.leaveMs, easing: EASE_OUT, useNativeDriver: NATIVE_DRIVER }),
        ]);
        run.start(({ finished }) => finished && live && setShow(false));
      });
    return () => {
      live = false;
      run?.stop();
      if (cut) clearTimeout(cut);
    };
  }, [show, tagline, all]);

  if (!show) return null;
  return (
    <Animated.View accessibilityLabel={`Pin'd. ${ONE_LINER}`} style={[styles.root, { opacity: all }]}>
      {/* Where the native splash drew it: the same file (1024 by 571), 200 wide, centred. */}
      <Image source={require("../../assets/splash-logo.png")} style={styles.logo} contentFit="contain" accessible={false} />
      <Animated.View style={[styles.under, { opacity: tagline, transform: [{ translateY: tagline.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>
        <Text style={styles.tagline}>{ONE_LINER}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.background, alignItems: "center", justifyContent: "center", zIndex: 10 },
  logo: { width: 200, height: 112 },
  // Beneath the logo without moving it off the splash's centre.
  under: { position: "absolute", top: "50%", marginTop: 76, left: 24, right: 24, alignItems: "center" },
  tagline: { fontFamily: fonts.headline, fontSize: 17, color: palette.text, textAlign: "center" },
});
