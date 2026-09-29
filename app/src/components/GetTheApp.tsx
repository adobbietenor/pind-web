// "Get the app" — once per person, when they first join a group (M3.3; build plan §8
// M3.3: "the moment you have a plan is the moment an app earns its place"). On the web
// only. It is marked seen the moment it is shown, so it never comes back — the person
// decided, whichever button they pressed.
//
// While GET_THE_APP.url is null there is nowhere real to send anyone, so it shows
// nothing at all (see packages/shared/src/after.ts).
import { useEffect, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, GET_THE_APP, radius, spacing } from "@pind/shared";
import { Body, Button } from "@/components/ui";
import { appNudgeSeen, markAppNudgeSeen, readProfile } from "@/lib/profile";

export function GetTheApp() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || !GET_THE_APP.url) return;
    let live = true;
    void (async () => {
      const me = await readProfile();
      if (!me.personId || (await appNudgeSeen(me.personId))) return;
      if (!live) return;
      setShow(true);
      await markAppNudgeSeen(me.personId);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!show || !GET_THE_APP.url) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{GET_THE_APP.heading}</Text>
      <Body muted>{GET_THE_APP.line}</Body>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={GET_THE_APP.yes} onPress={() => void Linking.openURL(GET_THE_APP.url!)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button kind="quiet" label={GET_THE_APP.no} onPress={() => setShow(false)} />
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
  heading: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
});
