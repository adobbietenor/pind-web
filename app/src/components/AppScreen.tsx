// The shell every scrolling app screen sits in (M3.1, after the TestFlight walk).
//
// **Two faults, one cause: every screen built its own frame.** The Profile tab had no
// header because it was the one screen that forgot the Brand row, and the keyboard
// covered the email-code field because no screen's ScrollView knew about the
// keyboard. Fixing either per screen would leave the next screen to forget again, so
// the frame is one component and `tests/unit/screens.test.ts` fails the build if a
// route draws its own SafeAreaView or ScrollView instead.
//
//   * The header — the mark at one end, the wordmark at the other — is always first.
//   * `automaticallyAdjustKeyboardInsets` (iOS) insets the scroll view by the
//     keyboard's height and keeps the focused field in view; `keyboardDismissMode`
//     lets a drag put the keyboard away. On the web the browser does this itself.
//   * Taps on a button while the keyboard is up still land (`handled`), so "Send the
//     code" works first time rather than only dismissing the keyboard.
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { colors as palette, spacing } from "@pind/shared";
import { Brand } from "./Brand";

export function AppScreen({
  children,
  edges = ["top", "bottom"],
  contentStyle,
  scroll = true,
}: {
  children?: ReactNode;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  // A screen with nothing to scroll (a loading state) still gets the header.
  scroll?: boolean;
}) {
  return (
    <SafeAreaView edges={edges} style={styles.root}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.body, contentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <Brand />
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, contentStyle]}>
          <Brand />
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  // Room under the last field, so the keyboard has something to scroll it clear of.
  body: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl * 2 },
});
