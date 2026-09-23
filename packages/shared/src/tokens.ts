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

  // A near-white carrying a trace of the brand hue, for a line that should lift off
  // the muted greys without spending the accent on it (Alex, M3.1, for the W1 card's
  // count-and-invitation line: "a white with a few percent of the brand hue mixed
  // in"). Measured against the plain near-white it replaced (#ECE9F1): the same
  // lightness (L* 92.9 against 92.8), the brand's own hue (309 deg against the
  // brand's 313), and about an eighth of its chroma (C* 7.7 against 58.4).
  // **15.13:1 on `surface`, 16.50:1 on `background`.** It is a small difference by
  // design — dE 3.4 from the colour it replaces, which is visible held side by side
  // and not from memory.
  textTint: "#EFE8F6",

  // The lightest purple that is still purple and still passes WCAG AA as TEXT on
  // dark: **5.33:1 on `surface`, 5.82:1 on `background`**, against AA's 4.5:1.
  // `accent` itself is 1.76:1 as text and fails outright, so this exists as a number
  // rather than being re-derived every time someone wants purple text.
  //
  // **Never for a link.** Links on the public pages are lilac (#c9a6ee); a different
  // purple inside a card that is itself a link reads as a link within a link.
  accentText: "#A874DB",
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
