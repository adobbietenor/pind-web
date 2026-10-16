import { useQuery } from "@tanstack/react-query";
import { Tabs } from "expo-router";
import { Easing, StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, MY_CHATS_COPY, unreadTotal } from "@pind/shared";
import { useReduceMotion } from "@/lib/motion";
import { loadMyChats, MY_CHATS_KEY } from "@/lib/myevents";

// The four tabs (spec §3): Crowds · My Events · Connections · Profile.
//
// **A city's list (A6/A7) sits inside the tabs, with no tab of its own** (#2): it is
// one tap down from Crowds, and as a Stack page above the tabs it took the bar away,
// so the only way back to another tab was Back. Still /city/<slug>. Back from it is
// Crowds (backBehavior "history").
//
// **Switching tabs crossfades** (the "feel alive" pass, 16 Oct 2026) — 150 ms, never a hard
// cut; and a hard cut again under Reduce Motion.
//
// **A dot on My Events when any chat of yours has something new** (A19, 16 Oct 2026). It
// reads the same query as the tab itself (MY_CHATS_KEY — one call, shared), refreshed
// once a minute; signed out, that call makes no request and the dot stays off. Beside the
// label, because the tabs have no icons yet for a badge to sit on.
export default function TabsLayout() {
  const reduce = useReduceMotion();
  const chats = useQuery({ queryKey: MY_CHATS_KEY, queryFn: loadMyChats, refetchInterval: 60_000, staleTime: 15_000 });
  const unread = chats.data ? unreadTotal(chats.data) : 0;
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
      <Tabs.Screen
        name="my-events"
        options={{
          title: "My Events",
          tabBarAccessibilityLabel: unread ? `My Events, ${MY_CHATS_COPY.unreadLabel(unread)}` : "My Events",
          tabBarLabel: ({ color }) => (
            <View style={styles.label}>
              <Text style={[styles.labelText, { color }]}>My Events</Text>
              {unread ? <View style={styles.dot} /> : null}
            </View>
          ),
        }}
      />
      <Tabs.Screen name="connections" options={{ title: "Connections" }} />
      <Tabs.Screen name="me" options={{ title: "Profile" }} />
      <Tabs.Screen name="city/[slug]" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: { flexDirection: "row", alignItems: "center", gap: 4 },
  labelText: { fontFamily: fonts.headline, fontSize: 13 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.accent },
});
