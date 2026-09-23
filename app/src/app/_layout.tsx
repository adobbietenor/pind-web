import { Poppins_600SemiBold } from "@expo-google-fonts/poppins/600SemiBold";
import { Poppins_700Bold } from "@expo-google-fonts/poppins/700Bold";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform, View } from "react-native";
import { colors as palette } from "@pind/shared";
import { initAnalytics, track } from "@/lib/analytics";
import { queryClient } from "@/lib/query";
import { initSentry, wrapRoot } from "@/lib/sentry";
import { isQuickPinPath } from "@/lib/typeface";

// Runs once per launch. Nothing here touches Supabase auth: opening the app
// creates no user (the anonymous user is made at pin, A26).
initSentry();
initAnalytics();

// Keep the native splash up until Poppins is ready, so headlines never flash in
// the fallback font.
SplashScreen.preventAutoHideAsync();

// **A26 on the web asks for no Poppins at all** (Alex, M3.2): the quick pin has W2's
// budget, and holding the whole page back for two font files was most of its first
// paint. It renders at once in the system face (typeface.ts). Decided on the URL a
// visitor LANDED on, so someone who lands on A26 keeps the system face for that tab.
const landedOnQuickPin =
  Platform.OS === "web" && typeof window !== "undefined" && isQuickPinPath(window.location.pathname);

function RootLayout() {
  const [fontsLoaded] = useFonts(landedOnQuickPin ? {} : { Poppins_600SemiBold, Poppins_700Bold });

  useEffect(() => {
    track("app_open");
  }, []);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Dark always (decisions Part 5, "Dark only").
  const theme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: palette.accent,
      background: palette.background,
      card: palette.background,
      text: palette.text,
      border: palette.border,
    },
  };

  // On the web there is no native splash: hold on the background colour instead.
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: palette.background }} />;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default wrapRoot(RootLayout);
