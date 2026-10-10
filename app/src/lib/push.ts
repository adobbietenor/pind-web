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
// Proved on M3.3b's build (the native list), where push is walked on a real phone.

import Constants from "expo-constants";
import type { NotificationResponse } from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { pushWasTaken, tapOpener } from "@pind/shared";
import { supabase } from "./supabase";

// What this phone last registered, and for whom (L8): so a registration that moved to
// another account is noticed here rather than silently taken back.
const REGISTERED = "pind.push.registered";

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

async function phoneToken(): Promise<string> {
  const N = await notifications();
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return (await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
}

async function signedInUser(): Promise<string | null> {
  return (await supabase().auth.getSession()).data.session?.user.id ?? null;
}

async function register(): Promise<void> {
  const token = await phoneToken();
  const { error } = await supabase().rpc("register_device", { p_token: token, p_platform: "ios" });
  if (error) throw error;
  const userId = await signedInUser();
  if (userId) await SecureStore.setItemAsync(REGISTERED, JSON.stringify({ token, userId })).catch(() => undefined);
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
// whoever is signed in now (a phone handed over, a sign-in to another account). Never a
// prompt — except (L8, Alex 6 Oct 2026) when this phone registered itself for this very
// account and another account has since taken it: then "taken", and the caller says so
// and asks, rather than taking it back silently (two accounts would trade it forever,
// and neither would ever be told).
export async function keepPushRegistered(): Promise<"ok" | "taken" | "off"> {
  if (!native) return "off";
  if ((await pushState()) !== "on") return "off";
  try {
    const token = await phoneToken();
    const userId = await signedInUser();
    if (!userId) return "off";
    const saved = await SecureStore.getItemAsync(REGISTERED).catch(() => null);
    const local = saved ? (JSON.parse(saved) as { token: string; userId: string }) : null;
    const { data, error } = await supabase().from("device_tokens").select("token").eq("token", token);
    if (!error && pushWasTaken({ local, token, userId, serverHasIt: (data ?? []).length > 0 })) return "taken";
    await register();
    return "ok";
  } catch {
    return "off";
  }
}

// "Leave them off", after "taken": asked once, not on every start.
export async function forgetPushRegistration(): Promise<void> {
  await SecureStore.deleteItemAsync(REGISTERED).catch(() => undefined);
}

// Sign out (A23; Alex, 10 Oct 2026): this phone stops getting the signed-in account's
// notifications. The tokens are the one this phone saved when it last registered and,
// if push is on, the phone's own now; a phone that never registered has nothing to take
// off. Throws when that cannot be done, so the sign-out stops there — a sign-out never
// leaves a phone receiving someone's notifications (P187 proves the delete is yours only).
export async function forgetThisPhone(): Promise<void> {
  if (!native) return;
  const saved = await SecureStore.getItemAsync(REGISTERED).catch(() => null);
  const tokens = new Set<string>();
  if (saved) tokens.add((JSON.parse(saved) as { token: string }).token);
  if ((await pushState()) === "on") {
    try {
      tokens.add(await phoneToken());
    } catch (err) {
      if (!tokens.size) throw err;
    }
  }
  if (tokens.size) {
    const { error } = await supabase().from("device_tokens").delete().in("token", [...tokens]);
    if (error) throw error;
  }
  await forgetPushRegistration();
}

// "Turn them back on", after "taken".
export async function takePushBack(): Promise<void> {
  if (native) await register();
}

// Tapping a notification opens the page it is about (its `path`, the same one the email
// links to). Returns the way to stop listening. Call it only once the navigator is
// mounted: on a cold start it opens the launching tap straight away.
export async function onNotificationTap(open: (path: string) => void): Promise<() => void> {
  if (!native) return () => undefined;
  const N = await notifications();
  N.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  const tap = tapOpener(open);
  const seen = (r: NotificationResponse) =>
    tap({ id: r.notification.request.identifier, data: r.notification.request.content.data });
  const sub = N.addNotificationResponseReceivedListener(seen);
  // A cold start (M3.3b): the tap that launched the app came before anything was listening.
  const launched = N.getLastNotificationResponse();
  if (launched) {
    seen(launched);
    N.clearLastNotificationResponse();
  }
  return () => sub.remove();
}
