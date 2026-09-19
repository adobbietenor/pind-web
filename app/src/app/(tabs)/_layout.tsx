import { Tabs } from "expo-router";
import { colors as palette, fonts } from "@pind/shared";

// The four tabs (spec §3): Crowds · My Events · Connections · Profile.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
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
    </Tabs>
  );
}
