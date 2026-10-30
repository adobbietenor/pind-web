// "Later" on one device (UI pass 1, round 2: the squad's "I've arrived" row): put away for
// this one thing, here, and nowhere else. The phone's SecureStore, or the browser's
// localStorage. Not remembered is the lesser fault: the row comes back, nothing is lost.
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const key = (what: string) => `pind.later.${what.replace(/[^A-Za-z0-9._-]/g, "_")}`;

export async function isPutAway(what: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(key(what)) === "1";
    return (await SecureStore.getItemAsync(key(what))) === "1";
  } catch {
    return false;
  }
}

export async function putAway(what: string): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(key(what), "1");
    else await SecureStore.setItemAsync(key(what), "1");
  } catch {
    // Not remembered: it shows again next time.
  }
}
