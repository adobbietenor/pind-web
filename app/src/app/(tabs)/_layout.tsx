import { useQuery } from "@tanstack/react-query";
import { Tabs } from "expo-router";
import { Easing } from "react-native";
import { MY_CHATS_COPY, unreadTotal } from "@pind/shared";
import { InTabs } from "@/components/AppScreen";
import { TabBar, type TabMeta } from "@/components/TabBar";
import { useReduceMotion } from "@/lib/motion";
import { loadMyChats, MY_CHATS_KEY } from "@/lib/myevents";
import { loadRequests, REQUESTS_KEY, requestCount } from "@/lib/requests";

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
// **Where the bar shows is this file, and only this file** (round 3, item 14): on every
// route inside (tabs), which is the four tabs, a city's list and the crowd page (A8/A9),
// and nowhere else. Every chat (room, squad, 1-on-1, the women-only room), sign-in and
// profile setup (A1-A3, A27), Settings and its pages are routes outside the group, stacked
// over it, so the bar is not there; a sheet is a modal over everything. tests/unit S67 fails
// if a route joins or leaves the group. Screens inside take the bottom edge from InTabs.
//
// **The bar itself is components/TabBar.tsx** (UI pass 1, round 3, item 13): an icon over
// each label, the active one filled in a soft purple pill, the same on iOS and the web.
//
// **My Events' unread count** (A19, 16 Oct 2026; a count on its icon since round 3) reads
// the same query as the tab itself (MY_CHATS_KEY — one call, shared), refreshed once a
// minute; signed out, that call makes no request and the count stays off. **Connections'
// dot when a request is waiting** (UI pass 1, 077) the same way.
export default function TabsLayout() {
  const reduce = useReduceMotion();
  const chats = useQuery({ queryKey: MY_CHATS_KEY, queryFn: loadMyChats, refetchInterval: 60_000, staleTime: 15_000 });
  const unread = chats.data ? unreadTotal(chats.data) : 0;
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: loadRequests, refetchInterval: 60_000, staleTime: 15_000 });
  const waiting = requestCount(requests.data);
  const tabs: Record<string, TabMeta> = {
    crowds: { icon: "pin", label: "Crowds", a11y: "Crowds" },
    "my-events": { icon: "chat", label: "My Events", count: unread, a11y: unread ? `My Events, ${MY_CHATS_COPY.unreadLabel(unread)}` : "My Events" },
    connections: { icon: "handshake", label: "Connections", dot: waiting > 0, a11y: waiting ? `Connections, ${waiting} waiting` : "Connections" },
    me: { icon: "person", label: "Profile", a11y: "Profile" },
  };
  return (
    <InTabs.Provider value>
    <Tabs
      backBehavior="history"
      tabBar={(props) => <TabBar {...props} tabs={tabs} />}
      screenOptions={{
        headerShown: false,
        animation: reduce ? "none" : "fade",
        transitionSpec: { animation: "timing", config: { duration: 150, easing: Easing.out(Easing.cubic) } },
      }}
    >
      <Tabs.Screen name="crowds" options={{ title: "Crowds" }} />
      <Tabs.Screen name="my-events" options={{ title: "My Events" }} />
      <Tabs.Screen name="connections" options={{ title: "Connections" }} />
      <Tabs.Screen name="me" options={{ title: "Profile" }} />
      <Tabs.Screen name="city/[slug]" options={{ href: null }} />
      <Tabs.Screen name="crowd/[slug]" options={{ href: null }} />
    </Tabs>
    </InTabs.Provider>
  );
}
