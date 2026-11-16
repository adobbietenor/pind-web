// A20 — Connections (M3.3; spec A20, Alex 29 Sept 2026).
//
// Everyone you are connected with (build 23, Alex 16 Nov 2026): a yes to a 1-on-1, or keeping
// in touch after the night (A16). Each has ONE chat, mutual both ways (never a cold DM, H2):
// its last line is on the row, and the row opens their profile, whose "Message" opens it.
// Requests come first. "Invite" still opens the gatherings you are pinned to, and sends the seventh notification
// ("Maya's going to X — want to come?"). The database holds the limits (V23, #7): only a
// connection, only a gathering you are pinned to, one per pair per gathering, five a
// day — and a block ends the connection on both sides.
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { A24_COPY, chatPreview, colors as palette, CONNECTIONS_COPY, fonts, ONE_ON_ONE_COPY, radius, spacing } from "@pind/shared";
import { RequestCard } from "@/components/RequestCard";
import { MoreButton, ReportBlockSheet, type ReportTarget } from "@/components/ReportBlock";
import { Tap } from "@/components/Tap";
import { MY_CHATS_KEY } from "@/lib/myevents";
import { connectionWith } from "@/lib/connections";
import { queryClient } from "@/lib/query";
import { loadRequests, REQUESTS_KEY } from "@/lib/requests";
import { answerSolo } from "@/lib/solo";
import { AppScreen } from "@/components/AppScreen";
import { EmptyCard } from "@/components/EmptyCard";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { answerKeep, invite, inviteOptions, isFiveADay, myConnections, type Connection, type InviteOption } from "@/lib/after";
import { failed, type Described } from "@/lib/errors";
import { Rise } from "@/components/Motion";

const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));

export default function Connections() {
  const [list, setList] = useState<Connection[] | undefined>(undefined);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [open, setOpen] = useState<{ personId: string; options: InviteOption[] | undefined } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ personId: string; line: string } | null>(null);
  const [refused, setRefused] = useState<{ personId: string; what: Described } | null>(null);
  // Requests first, then everyone you are connected with.
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: loadRequests, staleTime: 5_000 });
  const [answering, setAnswering] = useState<string | null>(null);
  const [a24, setA24] = useState<ReportTarget | null>(null);
  const [answerRefusal, setAnswerRefusal] = useState<{ id: string; says: string } | null>(null);
  const answer = async (proposalId: string, personId: string, accept: boolean) => {
    setAnswering(proposalId);
    setAnswerRefusal(null);
    try {
      await answerSolo(proposalId, accept);
      void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_CHATS_KEY });
      refresh();
      // Accept opens the chat: the pair's one chat, made by the yes.
      const chat = accept ? await connectionWith(personId) : null;
      if (chat) router.push({ pathname: "/chat/[id]", params: { id: chat } });
    } catch (err) {
      setAnswerRefusal({ id: proposalId, says: failed("answer that", err).says });
    } finally {
      setAnswering(null);
    }
  };

  const refresh = useCallback(() => {
    setTrouble(null);
    myConnections()
      .then(setList)
      .catch((err) => {
        setTrouble(failed("load your connections", err));
        setList((l) => l ?? []);
      });
  }, []);
  useFocusEffect(
    useCallback(() => {
      refresh();
      void requests.refetch();
    }, [refresh, requests.refetch]),
  );
  const waiting = requests.data?.solo ?? [];
  const keepWaiting = requests.data?.keep ?? [];
  const answerKeeping = async (requestId: string, accept: boolean) => {
    setAnswering(requestId);
    setAnswerRefusal(null);
    try {
      await answerKeep(requestId, accept);
      void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
      refresh();
    } catch (err) {
      setAnswerRefusal({ id: requestId, says: failed("answer that", err).says });
    } finally {
      setAnswering(null);
    }
  };

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
      <ReportBlockSheet target={a24} onClose={() => setA24(null)} onDone={() => refresh()} />
      <Heading>{CONNECTIONS_COPY.heading}</Heading>
      {trouble ? <Trouble what={trouble} onRetry={refresh} /> : null}
      {waiting.length || keepWaiting.length ? (
        <>
          <Text style={styles.section}>{ONE_ON_ONE_COPY.requests}</Text>
          {keepWaiting.map((r) => (
            <RequestCard
              key={r.requestId}
              name={r.firstName}
              photoPath={r.photoPath}
              title={CONNECTIONS_COPY.wantsToKeep(r.firstName)}
              line={CONNECTIONS_COPY.youMetAt(r.gatheringName)}
              busy={answering === r.requestId}
              refusal={answerRefusal?.id === r.requestId ? answerRefusal.says : null}
              onAccept={() => void answerKeeping(r.requestId, true)}
              onNotNow={() => void answerKeeping(r.requestId, false)}
            />
          ))}
          {waiting.map((r) => (
            <RequestCard
              key={r.proposalId}
              name={r.firstName}
              photoPath={r.photoPath}
              title={ONE_ON_ONE_COPY.wantsToMeet(r.firstName)}
              line={ONE_ON_ONE_COPY.at(r.gatheringName)}
              busy={answering === r.proposalId}
              refusal={answerRefusal?.id === r.proposalId ? answerRefusal.says : null}
              onAccept={() => void answer(r.proposalId, r.personId, true)}
              onNotNow={() => void answer(r.proposalId, r.personId, false)}
            />
          ))}
        </>
      ) : null}
      {list?.length && (waiting.length || keepWaiting.length) ? <Text style={styles.section}>{CONNECTIONS_COPY.kept}</Text> : null}
      {list === undefined ? (
        <ActivityIndicator color={palette.text} />
      ) : list.length === 0 && !waiting.length && !keepWaiting.length ? (
        <EmptyCard
          icon="handshake"
          heading={CONNECTIONS_COPY.emptyHeading}
          line={CONNECTIONS_COPY.empty}
          steps={CONNECTIONS_COPY.emptyHow}
          button={CONNECTIONS_COPY.emptyButton}
          buttonInside={false}
          onPress={() => router.push("/crowds")}
        />
      ) : list.length === 0 ? null : (
        list.map((c, i) => (
          <Rise key={c.personId} index={i} style={styles.card}>
            {/* Tap them: their profile, with "Message" (build 23). */}
            <View style={styles.cardTop}>
            <Tap feel="card" accessibilityRole="button" onPress={() => router.push(`/person/${c.personId}`)} style={[styles.row, { flex: 1 }]}>
              {c.photoUrl ? <Image source={{ uri: c.photoUrl }} style={styles.face} /> : <View style={[styles.face, styles.faceEmpty]} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{c.firstName}</Text>
                <Text numberOfLines={1} style={[styles.chatLine, c.unread > 0 && styles.unread]}>
                  {c.last ? chatPreview({ ...c.last, authorId: null, author: c.firstName }, ONE_ON_ONE_COPY.firstLine) : c.metAt ? (c.oneOnOne ? ONE_ON_ONE_COPY.oneOnOneAt(c.metAt) : CONNECTIONS_COPY.metAt(c.metAt)) : ONE_ON_ONE_COPY.firstLine}
                </Text>
              </View>
              {c.unread > 0 ? <View style={styles.dot} /> : null}
            </Tap>
            {/* A24: report or block, two taps (H9). */}
            <MoreButton label={A24_COPY.report(c.firstName)} onPress={() => setA24({ kind: "person", id: c.personId, firstName: c.firstName })} />
            </View>
            <Button label={ONE_ON_ONE_COPY.message} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: c.connectionId } })} />
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
          </Rise>
        ))
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: fonts.headline, fontSize: 16, color: palette.text, marginTop: spacing.lg },
  chat: { padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, marginTop: spacing.sm, gap: 2 },
  chatLine: { fontSize: 14, color: palette.textMuted, marginTop: 1 },
  unread: { color: palette.text, fontFamily: fonts.headline },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.accent },
  card: { padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, gap: spacing.sm, marginTop: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  face: { width: 52, height: 52, borderRadius: 26 },
  faceEmpty: { backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border },
  name: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  pickHeading: { fontFamily: fonts.headline, fontSize: 15, color: palette.text, marginTop: spacing.sm },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.sm },
});
