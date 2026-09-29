// "Get told when someone says hi" — our own card before the phone's permission prompt
// (M3.3). Shown only on the iPhone, only once someone is in a room, and only while push
// has not been decided. "Not now" costs nothing; the phone's own "Don't allow" is final
// until Settings, so it is never spent on someone who has not yet seen why (lib/push.ts).
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { colors as palette, PUSH_ASK, radius, spacing } from "@pind/shared";
import { Body, Button } from "@/components/ui";
import { pushState, turnOnPush } from "@/lib/push";

export function PushAsk() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushState().then((s) => setShow(s === "not-asked"));
  }, []);

  if (!show) return null;
  return (
    <View style={styles.card}>
      <Body>{PUSH_ASK.title}</Body>
      <Body muted>{PUSH_ASK.line}</Body>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label={PUSH_ASK.yes}
            busy={busy}
            onPress={async () => {
              setBusy(true);
              await turnOnPush().catch(() => false);
              setBusy(false);
              setShow(false);
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button kind="quiet" label={PUSH_ASK.no} onPress={() => setShow(false)} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
});
