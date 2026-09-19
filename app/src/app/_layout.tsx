import { Poppins_600SemiBold } from "@expo-google-fonts/poppins/600SemiBold";
import { Poppins_700Bold } from "@expo-google-fonts/poppins/700Bold";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { colors } from "@pind/shared";
import { initAnalytics, track } from "@/lib/analytics";
import { queryClient } from "@/lib/query";
import { initSentry, wrapRoot } from "@/lib/sentry";
import { useScheme } from "@/lib/theme";

// Runs once per launch. Nothing here touches Supabase auth: opening the app
// creates no user (the anonymous user is made at pin, A26).
initSentry();
initAnalytics();

function RootLayout() {
  const scheme = useScheme();
  const palette = colors[scheme];
  const [fontsLoaded] = useFonts({ Poppins_600SemiBold, Poppins_700Bold });

  useEffect(() => {
    track("app_open");
  }, []);

  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.accent,
      background: palette.background,
      card: palette.background,
      text: palette.text,
      border: palette.border,
    },
  };

  // Hold on the background colour until Poppins is ready, so headlines never
  // flash in the fallback font.
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: palette.background }} />;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={theme}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default wrapRoot(RootLayout);
