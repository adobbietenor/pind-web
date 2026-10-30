// A request waiting for my answer (UI pass 1, 077 and 095): a face, who and where, Accept
// and Not now. The same card for a 1-on-1 request and a keep-in-touch request. "Not now" is
// silent to the sender (the database keeps their side as sent).
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, ONE_ON_ONE_COPY, radius, spacing } from "@pind/shared";
import { Avatar } from "./Avatar";
import { Tap } from "./Tap";
import { photoUrl } from "@/lib/profile";

export function RequestCard({
  name,
  photoPath,
  title,
  line,
  busy,
  refusal,
  onAccept,
  onNotNow,
}: {
  name: string;
  photoPath: string | null;
  title: string;
  line: string;
  busy: boolean;
  refusal: string | null;
  onAccept: () => void;
  onNotNow: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    photoUrl(photoPath).then((u) => live && setUrl(u), () => undefined);
    return () => {
      live = false;
    };
  }, [photoPath]);
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Avatar name={name} source={url} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.line}>{line}</Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <Tap accessibilityRole="button" disabled={busy} onPress={onAccept} style={[styles.button, styles.accept]}>
          <Text style={styles.acceptLabel}>{ONE_ON_ONE_COPY.accept}</Text>
        </Tap>
        <Tap accessibilityRole="button" disabled={busy} onPress={onNotNow} style={[styles.button, styles.notNow]}>
          <Text style={styles.notNowLabel}>{ONE_ON_ONE_COPY.notNow}</Text>
        </Tap>
      </View>
      {refusal ? <Text accessibilityRole="alert" style={styles.refusal}>{refusal}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm + 4, borderWidth: 1, borderColor: palette.accent, borderRadius: radius.md, backgroundColor: palette.surface, marginTop: spacing.sm },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4 },
  title: { fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  line: { fontSize: 13, color: palette.textMuted, marginTop: 1 },
  buttons: { flexDirection: "row", gap: spacing.sm },
  button: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  accept: { backgroundColor: palette.accent },
  notNow: { borderWidth: 1, borderColor: palette.border },
  acceptLabel: { fontFamily: fonts.headline, fontSize: 15, color: palette.onAccent },
  notNowLabel: { fontFamily: fonts.headline, fontSize: 15, color: palette.text },
  refusal: { fontSize: 14, color: "#F3B4B4" },
});
