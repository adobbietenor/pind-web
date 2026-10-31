// The bottom tab bar, every screen, iOS and the web (UI pass 1, round 3, item 13; Option A on
// the design canvas). Drawn once here and handed to Tabs as its `tabBar`:
//
//   * An icon above each label: Crowds (map pin), My Events (chat bubble), Connections
//     (handshake), Profile (person). Line icons; the active one filled (packages/shared
//     icons.ts, FILLED).
//   * The active tab sits in a soft purple pill behind its icon (the accent at low strength),
//     with a bold label; inactive tabs are grey.
//   * My Events wears an unread count, Connections a dot when a request is waiting: both read
//     from the queries the tabs layout already holds (no new call).
//   * Switching gives a light haptic tap; the tab already open gives none. The pill grows in
//     inside 250 ms on React Native's Animated, and is simply there under Reduce Motion (S46).
//     Every tab is a Tap (S45), at least 44 pt tall.
import { Tabs } from "expo-router";
import { useEffect, useRef, type ComponentProps } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors as palette, fonts, iconUri, type IconName } from "@pind/shared";
import { Tap } from "./Tap";
import { EASE_OUT, NATIVE_DRIVER, useReduceMotion } from "@/lib/motion";

export interface TabMeta {
  icon: IconName;
  label: string;
  // A count on the icon (My Events' unread), or a dot (Connections' waiting request).
  count?: number;
  dot?: boolean;
  a11y: string;
}

const PILL_MS = 200;
// What Tabs hands its tabBar (expo-router re-exports the navigator; no package of our own).
type BarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  const color = focused ? palette.tabActive : palette.tabInactive;
  return (
    <Image
      source={{ uri: iconUri(name, 24, color, focused ? { hole: palette.background } : undefined) }}
      style={{ width: 24, height: 24 }}
      accessible={false}
    />
  );
}

function Pill({ focused }: { focused: boolean }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return v.setValue(focused ? 1 : 0);
    const a = Animated.timing(v, { toValue: focused ? 1 : 0, duration: PILL_MS, easing: EASE_OUT, useNativeDriver: NATIVE_DRIVER });
    a.start();
    return () => a.stop();
  }, [focused, reduce, v]);
  return <Animated.View pointerEvents="none" style={[styles.pill, { opacity: v, transform: [{ scaleX: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }]} />;
}

export function TabBar({ state, descriptors, navigation, insets, tabs }: BarProps & { tabs: Record<string, TabMeta> }) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      {state.routes.map((route, index) => {
        const meta = tabs[route.name];
        // Routes inside the tabs with no tab of their own (a city's list, #2).
        if (!meta) return null;
        // A city's list and a crowd page have no tab of their own: Crowds is where they sit.
        const here = state.routes[state.index]?.name ?? "";
        const focused = state.index === index || (route.name === "crowds" && !tabs[here]);
        const { options } = descriptors[route.key]!;
        const go = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Tap
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={meta.a11y}
            testID={options.tabBarButtonTestID}
            // A light tap on switching; nothing on the tab already open.
            haptic={state.index === index ? null : "action"}
            onPress={go}
            onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
            style={styles.tab}
          >
            <View style={styles.iconBox}>
              <Pill focused={focused} />
              <TabIcon name={meta.icon} focused={focused} />
              {meta.count ? (
                <View style={styles.count}>
                  <Text style={styles.countText}>{meta.count > 99 ? "99+" : String(meta.count)}</Text>
                </View>
              ) : meta.dot ? (
                <View style={styles.dot} />
              ) : null}
            </View>
            <Text numberOfLines={1} style={[styles.label, focused ? styles.labelOn : null]}>
              {meta.label}
            </Text>
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: palette.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, paddingTop: 6 },
  tab: { flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 3 },
  iconBox: { width: 60, height: 32, alignItems: "center", justifyContent: "center" },
  pill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16, backgroundColor: palette.tabPill },
  label: { fontSize: 12, fontWeight: "500", color: palette.tabInactive },
  labelOn: { fontFamily: fonts.headline, color: palette.tabActive },
  count: { position: "absolute", top: -2, left: 34, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: palette.background },
  countText: { fontFamily: fonts.headline, fontSize: 10, color: palette.onAccent, lineHeight: 12 },
  dot: { position: "absolute", top: 2, left: 38, width: 9, height: 9, borderRadius: 5, backgroundColor: palette.accent, borderWidth: 1.5, borderColor: palette.background },
});
