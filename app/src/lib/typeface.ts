// The headline face, with a fallback that is a system font on the web (M3.2).
//
// A26 — the quick pin — does not load Poppins at all (its budget is W2's, and two
// Poppins weights were 142 KB competing with the first screen). On the web a
// fontFamily is a CSS font-family, so an unloaded "Poppins_600SemiBold" would fall back
// to the browser's default — usually a serif. This stack falls back to the phone's own
// sans instead, and wherever Poppins is loaded it still wins. On a phone the family
// must be a single name, so it stays exactly as before.
import { Platform } from "react-native";
import { fonts } from "@pind/shared";

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const headlineFamily = Platform.OS === "web" ? `${fonts.headline}, ${SYSTEM}` : fonts.headline;

// The quick pin route on the web: /g/<slug>/pin. The one route that skips Poppins.
export function isQuickPinPath(pathname: string): boolean {
  return /^\/g\/[^/]+\/pin\/?$/.test(pathname);
}
