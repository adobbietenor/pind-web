// How things arrive (the "feel alive" pass, 16 Oct 2026). Three entrances, all on React
// Native's own Animated, all inside ~250 ms, all instant under Reduce Motion (lib/motion.ts):
//
//   * Rise — a list's cards fade and rise in, a little staggered. Once, when each mounts:
//     a refresh that keeps the same keys moves nothing.
//   * Pop — the pin's moment: a small spring as "You're pinned" lands.
//   * Arrive — a new message slides in from its own side: mine from the right, theirs from
//     the left.
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";
import { EASE_OUT, NATIVE_DRIVER, RISE_MS, RISE_PX, STAGGER_MAX, STAGGER_MS, useReduceMotion } from "@/lib/motion";

// `animate` is read once, at mount: false mounts already in place.
function useEntrance(run: (v: Animated.Value) => Animated.CompositeAnimation, animate = true): Animated.Value {
  const reduce = useReduceMotion();
  const still = reduce || !animate;
  const v = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) {
      v.setValue(1);
      return;
    }
    const a = run(v);
    a.start();
    return () => a.stop();
    // Once, on mount: an entrance is not replayed when the props change.
  }, []);
  return v;
}

export function Rise({ index = 0, children, style }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useEntrance((x) =>
    Animated.timing(x, { toValue: 1, duration: RISE_MS, delay: Math.min(index, STAGGER_MAX) * STAGGER_MS, easing: EASE_OUT, useNativeDriver: NATIVE_DRIVER }),
  );
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [RISE_PX, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export function Pop({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useEntrance((x) => Animated.spring(x, { toValue: 1, speed: 18, bounciness: 10, useNativeDriver: NATIVE_DRIVER }));
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Always the wrapper, so a bubble is never remounted when it stops being new; `animate`
// decides at mount whether it slides.
export function Arrive({ fromRight, animate, children }: { fromRight: boolean; animate: boolean; children: ReactNode }) {
  const v = useEntrance((x) => Animated.timing(x, { toValue: 1, duration: RISE_MS, easing: EASE_OUT, useNativeDriver: NATIVE_DRIVER }), animate);
  return (
    <Animated.View
      style={{ opacity: v, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [fromRight ? 16 : -16, 0] }) }] }}
    >
      {children}
    </Animated.View>
  );
}
