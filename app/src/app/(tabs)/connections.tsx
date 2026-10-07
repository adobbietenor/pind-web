// A20 — Connections (M3.3; spec A20, Alex 29 Sept 2026).
//
// People you met and both chose to keep in touch with (A16), with where you met. **The
// only verb is "invite"** — deliberately not an inbox: no messages, no profile browsing.
// Invite opens the gatherings you are pinned to, and sends the seventh notification
// ("Maya's going to X — want to come?"). The database holds the limits (V23, #7): only a
// connection, only a gathering you are pinned to, one per pair per gathering, five a
// day — and a block ends the connection on both sides.
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { colors as palette, CONNECTIONS_COPY, fonts, radius, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { invite, inviteOptions, isFiveADay, myConnections, type Connection, type InviteOption } from "@/lib/after";
import { failed, type Described } from "@/lib/errors";

const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));

export default function Connections() {
  const [list, setList] = useState<Connection[] | undefined>(undefined);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [open, setOpen] = useState<{ personId: string; options: InviteOption[] | undefined } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ personId: string; line: string } | null>(null);
  const [refused, setRefused] = useState<{ personId: string; what: Described } | null>(null);

  const refresh = useCallback(() => {
    setTrouble(null);
    myConnections()
      .then(setList)
      .catch((err) => {
        setTrouble(failed("load your connections", err));
        setList((l) => l ?? []);
      });
  }, []);
  useFocusEffect(refresh);

  const pick = async (c: Connection) => {
    setSaid(null);
    setRefused(null);
    if (open?.personId === c.personId) return setOpen(null);
    setOpen({ personId: c.personId, options: undefined });
    try {
      setOpen({ personId: c.personId, options: await inviteOptions(c.personId) });
    } catch (err) {
      setOpen(null);
      setRefused({ personId: c.personId, what: failed("load what you're going to", err) });
    }
  };

  const send = async (c: Connection, o: InviteOption) => {
    setBusy(o.gatheringId);
    setRefused(null);
    try {
      await invite(c.personId, o.gatheringId);
      setSaid({ personId: c.personId, line: CONNECTIONS_COPY.sent(c.firstName) });
      setOpen({ personId: c.personId, options: await inviteOptions(c.personId) });
    } catch (err) {
      setRefused({ personId: c.personId, what: isFiveADay(err) ? { says: CONNECTIONS_COPY.fiveADay } : failed("send that invite", err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppScreen>
      <Heading>{CONNECTIONS_COPY.heading}</Heading>
      {trouble ? <Trouble what={trouble} onRetry={refresh} /> : null}
      {list === undefined ? (
        <ActivityIndicator color={palette.text} />
      ) : list.length === 0 ? (
        <Notice>{CONNECTIONS_COPY.empty}</Notice>
      ) : (
        list.map((c) => (
          <View key={c.personId} style={styles.card}>
            <View style={styles.row}>
              {c.photoUrl ? <Image source={{ uri: c.photoUrl }} style={styles.face} /> : <View style={[styles.face, styles.faceEmpty]} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{c.firstName}</Text>
                {c.metAt ? <Body muted>{CONNECTIONS_COPY.metAt(c.metAt)}</Body> : null}
              </View>
            </View>
            <Button kind="quiet" label={open?.personId === c.personId ? CONNECTIONS_COPY.close : CONNECTIONS_COPY.invite} onPress={() => void pick(c)} />
            {open?.personId === c.personId ? (
              open.options === undefined ? (
                <ActivityIndicator color={palette.text} />
              ) : open.options.length === 0 ? (
                <Body muted>{CONNECTIONS_COPY.pickEmpty}</Body>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  <Text style={styles.pickHeading}>{CONNECTIONS_COPY.pickHeading(c.firstName)}</Text>
                  {open.options.map((o) => (
                    <View key={o.gatheringId} style={styles.option}>
                      <View style={{ flex: 1 }}>
                        <Body>{o.name}</Body>
                        <Body muted>{day(o.startsAt)}</Body>
                      </View>
                      {o.already ? (
                        <Body muted>{o.already === "going" ? CONNECTIONS_COPY.going : CONNECTIONS_COPY.invited}</Body>
                      ) : (
                        <Button label={CONNECTIONS_COPY.invite} busy={busy === o.gatheringId} disabled={!!busy} onPress={() => void send(c, o)} />
                      )}
                    </View>
                  ))}
                </View>
              )
            ) : null}
            {said?.personId === c.personId ? <Notice>{said.line}</Notice> : null}
            {refused?.personId === c.personId ? <Trouble what={refused.what} /> : null}
          </View>
        ))
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, gap: spacing.sm, marginTop: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  face: { width: 52, height: 52, borderRadius: 26 },
  faceEmpty: { backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border },
  name: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  pickHeading: { fontFamily: fonts.headline, fontSize: 15, color: palette.text, marginTop: spacing.sm },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.sm },
});
