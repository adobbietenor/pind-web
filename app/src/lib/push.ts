// Push on the iPhone (M3.3; spec A18). The phone registers its Expo push token with the
// person signed in on it (`register_device`: one phone, one person); the Worker's
// every-minute delivery sends to it, and emails anyone without one.
//
// **Never asked at launch.** The phone's permission prompt is shown only after the
// person taps "Turn on" on our own card, which appears once they are in a room and push
// has something worth saying (PUSH_ASK). A "no" to our card costs nothing and can be
// revisited; a "no" to the phone's prompt is final until Settings, so it is not spent
// on someone who has not yet seen why.
//
// On the web there is no push: email carries every notification, and nothing here runs.
// Proved on M3.2b's build (the native list), where push is walked on a real phone.

import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

export type PushState = "unavailable" | "on" | "off" | "not-asked";

const native = Platform.OS === "ios";

async function notifications() {
  return import("expo-notifications");
}

// Where push stands on this phone.
export async function pushState(): Promise<PushState> {
  if (!native) return "unavailable";
  const N = await notifications();
  const { status, canAskAgain } = await N.getPermissionsAsync();
  if (status === "granted") return "on";
  return canAskAgain ? "not-asked" : "off";
}

async function register(): Promise<void> {
  const N = await notifications();
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const token = (await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  const { error } = await supabase().rpc("register_device", { p_token: token, p_platform: "ios" });
  if (error) throw error;
}

// "Turn on": the phone's own prompt, then the registration. True when push is on.
export async function turnOnPush(): Promise<boolean> {
  if (!native) return false;
  const N = await notifications();
  const asked = await N.requestPermissionsAsync();
  if (asked.status !== "granted") return false;
  await register();
  return true;
}

// On every start with a session: if push is already on, keep this phone registered to
// whoever is signed in now (a phone handed over, a sign-in to another account). Silent,
// and never a prompt.
export async function keepPushRegistered(): Promise<void> {
  if (!native) return;
  if ((await pushState()) !== "on") return;
  await register().catch(() => undefined);
}

// Tapping a notification opens the page it is about (its `path`, the same one the email
// links to). Returns the way to stop listening.
export async function onNotificationTap(open: (path: string) => void): Promise<() => void> {
  if (!native) return () => undefined;
  const N = await notifications();
  N.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  const sub = N.addNotificationResponseReceivedListener((r) => {
    const path = (r.notification.request.content.data as { path?: unknown } | undefined)?.path;
    if (typeof path === "string" && path.startsWith("/")) open(path);
  });
  return () => sub.remove();
}
