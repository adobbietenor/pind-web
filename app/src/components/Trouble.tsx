// A failure sentence with its exit attached (M3.1, from the airplane-mode walk).
//
// **A screen that tells you to go somewhere has to take you there.** A2 said "Go back
// and sign in again" with no button, and swiping was the only way out. So a sentence
// whose `wayOut` is sign-in always comes with the button to sign in, and one whose
// way out is trying again comes with Try again — the button sits under the sentence,
// where the person is looking.
import { useRouter } from "expo-router";
import { View } from "react-native";
import { spacing } from "@pind/shared";
import type { Described } from "@/lib/errors";
import { Button, Notice } from "./ui";

export function Trouble({ what, onRetry, busy }: { what: Described; onRetry?: () => void; busy?: boolean }) {
  const router = useRouter();
  return (
    <View style={{ marginBottom: spacing.md }}>
      {/* Only the sentence: technical detail goes to Sentry, never the screen. */}
      <Notice tone="stop">{what.says}</Notice>
      {what.wayOut === "sign-in" ? (
        <Button kind="quiet" label="Sign in again" onPress={() => router.replace("/sign-in")} />
      ) : what.wayOut === "retry" && onRetry ? (
        <Button kind="quiet" label="Try again" busy={busy} onPress={onRetry} />
      ) : null}
    </View>
  );
}
