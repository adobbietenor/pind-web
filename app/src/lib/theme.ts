import { useColorScheme } from "react-native";
import { colors, type ColorScheme, type Palette } from "@pind/shared";

// Dark is the default; light only when the system says so (spec §3, A25).
export function useScheme(): ColorScheme {
  return useColorScheme() === "light" ? "light" : "dark";
}

export function usePalette(): Palette {
  return colors[useScheme()];
}
