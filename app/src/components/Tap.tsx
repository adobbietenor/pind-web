// The one thing in the app you press (the "feel alive" pass, 16 Oct 2026) — the same shape
// as AppScreen and Composer: drawn once, so every press feels the same and no screen can
// forget. `tests/unit/screens.test.ts` (S45) fails if anything else imports a raw Pressable.
//
//   * Press: scales down a touch on touch, springs back on release (lib/motion.ts).
//   * Haptic: chips, radios, checkboxes and tabs give the selection tick by themselves; a
//     primary act (pin, send, join, propose, accept) asks for "action" at its call site.
//     Nothing on a passive tap, and nothing on the web (lib/motion.ts says why).
//   * The web: on hover, a card lifts and grows a touch; a button brightens.
//   * Reduce Motion: the scale and the lift go instant. The haptic stays.
//
// A caller's style may be a function of { pressed, hovered }, exactly as Pressable's: it is
// resolved here, so the press can be animated on the same element without a wrapper View
// that would change anyone's layout.
import { forwardRef, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  type GestureResponderEvent,
  type MouseEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type View,
  type ViewStyle,
} from "react-native";
import { haptic, NATIVE_DRIVER, PRESS_SCALE, PRESS_SPRING, useReduceMotion, type HapticKind } from "@/lib/motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const WEB = Platform.OS === "web";
// Roles that are a choice among several: their tap is a selection.
const SELECTS = new Set(["radio", "checkbox", "tab", "switch", "togglebutton"]);

// How it answers a hover on the web. "plain" (the default) answers nothing.
export type TapFeel = "button" | "card" | "plain";

type TapState = PressableStateCallbackType & { hovered?: boolean };
export type TapProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle> | ((state: TapState) => StyleProp<ViewStyle>);
  feel?: TapFeel;
  // Undefined: "select" for a choice, nothing otherwise. null: never, even for a choice.
  haptic?: HapticKind | null;
};

export const Tap = forwardRef<View, TapProps>(function Tap(
  { style, feel = "plain", haptic: asked, onPress, onPressIn, onPressOut, onHoverIn, onHoverOut, disabled, ...rest },
  ref,
) {
  const reduce = useReduceMotion();
  const press = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const role = (rest.accessibilityRole ?? rest.role) as string | undefined;
  const kind: HapticKind | null = asked === undefined ? (role && SELECTS.has(role) ? "select" : null) : asked;

  const move = (value: Animated.Value, to: number) => {
    if (reduce) value.setValue(to);
    else Animated.spring(value, { toValue: to, useNativeDriver: NATIVE_DRIVER, ...PRESS_SPRING }).start();
  };

  const resolved = typeof style === "function" ? style({ pressed, hovered }) : style;
  // The phone animates the press on the native driver; the web's hover is JS-driven, and the
  // two may not share a node — so only the web composes them.
  const transform = WEB && feel === "card"
    ? [
        { scale: Animated.multiply(press, lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] })) },
        { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
      ]
    : [{ scale: press }];
  const brighten = WEB && feel === "button" && hovered && !disabled
    ? ({ filter: "brightness(1.12)" } as unknown as ViewStyle)
    : null;
  const webTransition = WEB && feel === "button"
    ? ({ transitionProperty: "filter", transitionDuration: reduce ? "0ms" : "150ms" } as unknown as ViewStyle)
    : null;

  return (
    <AnimatedPressable
      ref={ref}
      disabled={disabled}
      {...rest}
      style={[resolved, webTransition, brighten, { transform }]}
      onPressIn={(e: GestureResponderEvent) => {
        setPressed(true);
        if (!disabled) move(press, PRESS_SCALE);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressed(false);
        move(press, 1);
        onPressOut?.(e);
      }}
      onPress={(e: GestureResponderEvent) => {
        if (kind && !disabled) haptic(kind);
        onPress?.(e);
      }}
      onHoverIn={(e: MouseEvent) => {
        setHovered(true);
        if (feel === "card") move(lift, 1);
        onHoverIn?.(e);
      }}
      onHoverOut={(e: MouseEvent) => {
        setHovered(false);
        if (feel === "card") move(lift, 0);
        onHoverOut?.(e);
      }}
    />
  );
});
