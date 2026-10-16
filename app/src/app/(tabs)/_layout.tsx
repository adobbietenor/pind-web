import { Tabs } from "expo-router";
import { Easing } from "react-native";
import { colors as palette, fonts } from "@pind/shared";
import { useReduceMotion } from "@/lib/motion";

// The four tabs (spec §3): Crowds · My Events · Connections · Profile.
//
// **A city's list (A6/A7) sits inside the tabs, with no tab of its own** (#2): it is
// one tap down from Crowds, and as a Stack page above the tabs it took the bar away,
// so the only way back to another tab was Back. Still /city/<slug>. Back from it is
// Crowds (backBehavior "history").
//
// **Switching tabs crossfades** (the "feel alive" pass, 16 Oct 2026) — 150 ms, never a hard
// cut; and a hard cut again under Reduce Motion.
export default function TabsLayout() {
  const reduce = useReduceMotion();
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        animation: reduce ? "none" : "fade",
        transitionSpec: { animation: "timing", config: { duration: 150, easing: Easing.out(Easing.cubic) } },
        tabBarActiveTintColor: palette.tabActive,
        tabBarInactiveTintColor: palette.tabInactive,
        tabBarStyle: { backgroundColor: palette.background, borderTopColor: palette.border },
        tabBarLabelStyle: { fontFamily: fonts.headline, fontSize: 13 },
        tabBarLabelPosition: "below-icon",
        // Labels only until tab icons are decided (spec §3 calls for SF Symbols).
        tabBarIconStyle: { display: "none" },
      }}
    >
      <Tabs.Screen name="crowds" options={{ title: "Crowds" }} />
      <Tabs.Screen name="my-events" options={{ title: "My Events" }} />
      <Tabs.Screen name="connections" options={{ title: "Connections" }} />
      <Tabs.Screen name="me" options={{ title: "Profile" }} />
      <Tabs.Screen name="city/[slug]" options={{ href: null }} />
    </Tabs>
  );
}
