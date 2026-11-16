// A24 — Settings → Blocked people (Alex, 16 Nov 2026). The people you blocked, read through
// my_blocks (yours only, P317), each with Unblock. Unblocking is said plainly before it is
// done: it gives back seeing each other at events you're both going to, and asking again; it
// does not give back the old chat or connection, a squad you left, or a called-off 1-on-1.
// They are never told, either way (H9).
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { A24_COPY, colors as palette, fonts, radius, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { myBlocks, unblockPerson, type Blocked } from "@/lib/connections";
import { failed, type Described } from "@/lib/errors";

export default function BlockedPeople() {
  const [list, setList] = useState<Blocked[] | undefined>(undefined);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const read = useCallback(() => {
    myBlocks().then(setList, (err) => {
      setTrouble(failed("load the people you blocked", err));
      setList((l) => l ?? []);
    });
  }, []);
  useFocusEffect(read);

  const unblock = async (b: Blocked) => {
    setBusy(true);
    setTrouble(null);
    try {
      await unblockPerson(b.personId);
      setAsking(null);
      setDone(A24_COPY.unblocked(b.firstName));
      read();
    } catch (err) {
      setTrouble(failed("unblock them", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppScreen>
      <Heading>{A24_COPY.blockedHeading}</Heading>
      {done ? <Notice>{done}</Notice> : null}
      {trouble ? <Trouble what={trouble} onRetry={read} /> : null}
      {list === undefined ? (
        <ActivityIndicator color={palette.textMuted} />
      ) : list.length === 0 ? (
        <Body muted>{A24_COPY.blockedNone}</Body>
      ) : (
        list.map((b) => (
          <View key={b.personId} style={styles.card}>
            <Text style={styles.name}>{b.firstName}</Text>
            {asking === b.personId ? (
              <>
                <Body>{A24_COPY.unblockWhat}</Body>
                <Button label={A24_COPY.unblock} busy={busy} onPress={() => void unblock(b)} />
                <Button kind="quiet" label={A24_COPY.cancel} onPress={() => setAsking(null)} />
              </>
            ) : (
              <Button kind="quiet" label={A24_COPY.unblock} onPress={() => setAsking(b.personId)} />
            )}
          </View>
        ))
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, marginTop: spacing.md },
  name: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
});
