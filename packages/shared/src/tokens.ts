// Design tokens (spec §3, A25): purple #582883, Poppins headlines, system body
// font, dark by default, light follows the system setting. Same anatomy and the
// same purple in both schemes.

export const PURPLE = "#582883";

export const colors = {
  dark: {
    background: "#0B0A0D",
    surface: "#17151B",
    border: "#2A2730",
    text: "#FFFFFF",
    textMuted: "#A7A2AF",
    accent: PURPLE,
    onAccent: "#FFFFFF",
    tabActive: "#FFFFFF",
    tabInactive: "#8A8592",
  },
  light: {
    background: "#FFFFFF",
    surface: "#F4F2F6",
    border: "#E2DEE7",
    text: "#111013",
    textMuted: "#5F5A66",
    accent: PURPLE,
    onAccent: "#FFFFFF",
    tabActive: PURPLE,
    tabInactive: "#77727E",
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type Palette = { [K in keyof (typeof colors)["dark"]]: string };

// Font family names as registered with expo-font. Body text uses the platform's
// system font (SF Pro on iOS), so it has no family name.
export const fonts = {
  headline: "Poppins_600SemiBold",
  headlineBold: "Poppins_700Bold",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20 } as const;
