// Design tokens (spec §3): purple #582883, Poppins headlines, system body font.
// Dark always, whatever the phone's setting (Alex, M2.0; decisions Part 5
// "Dark only"). There is no light palette.

export const PURPLE = "#582883";

export const colors = {
  background: "#0B0A0D",
  surface: "#17151B",
  border: "#2A2730",
  text: "#FFFFFF",
  textMuted: "#A7A2AF",
  accent: PURPLE,
  onAccent: "#FFFFFF",
  tabActive: "#FFFFFF",
  tabInactive: "#8A8592",
} as const;

export type Palette = typeof colors;

// Font family names as registered with expo-font. Body text uses the platform's
// system font (SF Pro on iOS), so it has no family name.
export const fonts = {
  headline: "Poppins_600SemiBold",
  headlineBold: "Poppins_700Bold",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20 } as const;
