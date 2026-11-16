// A29 / A20 — the chat between two connected people (build 23; Alex, 16 Nov 2026).
//
// **One chat per pair.** A yes to a 1-on-1 makes the two of you connections, and this is
// your chat: the one Accept opens, the one "Message" opens from a profile, and the same one a
// keep-in-touch connection has. It is mutual both ways, so never a cold DM (H2). It lasts as
// long as the connection — not Q11's 30 days — and ends, silently and for both, when either
// of you removes the connection, calls off the 1-on-1, blocks or reports the other (P274,
// P308–P310). Only its two can read or write it (connection_messages' policies, P268/P311).
//
// When a 1-on-1 between you is on (or just done), its event sits under the header: the
// optional "Add a place or time" (nothing depends on it), "I've arrived" on the night, and
// A17's "How did it go?" after it. No step here asks for a place or time.
//
// Long-press their message to report THEM (H9): a report on the person, which also ends
// the chat. The thread is lib/thread.ts's, as the room's and a squad's.
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { AFTER_COPY, colors as palette, effectiveEnd, fonts, HERE_COPY, ONE_ON_ONE_COPY, SOLO_COPY, spacing, type ThreadMessage } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Avatar } from "@/components/Avatar";
import { Composer } from "@/components/Composer";
import { ImHere } from "@/components/ImHere";
import { MessageSheet } from "@/components/MessageSheet";
import { Sheet } from "@/components/Sheet";
import { SoloPlace } from "@/components/SoloPlace";
import { Tap } from "@/components/Tap";
import { ThreadMessages } from "@/components/ThreadMessages";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading } from "@/components/ui";
import { loadOneOnOneCard, loadPairChat, removeConnection, sharedOneOnOne } from "@/lib/connections";
import { failed, type Described } from "@/lib/errors";
import { MY_CHATS_KEY } from "@/lib/myevents";
import { isPutAway, putAway } from "@/lib/putaway";
import { queryClient } from "@/lib/query";
import { markPairSeen, myPersonId, reportPerson, sendPairMessage } from "@/lib/room";
import { signedPhotoUrls } from "@/lib/signed-photos";
import { supabase } from "@/lib/supabase";
import { useThread } from "@/lib/thread";

const SHELL_MS = 30_000;
const SEEN_MS = 60_000;

async function loadShell(connectionId: string) {
  const meId = await myPersonId();
  if (!meId) return null;
  const chat = await loadPairChat(connectionId);
  if (!chat) return { meId, chat: null, photoUrl: null, card: null };
  const [urls, crewId] = await Promise.all([signedPhotoUrls([chat.photoPath]), sharedOneOnOne(meId, chat.personId)]);
  const card = crewId ? await loadOneOnOneCard(crewId) : null;
  return { meId, chat, photoUrl: chat.photoPath ? urls.get(chat.photoPath) ?? null : null, card };
}

export default function PairChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [menu, setMenu] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [held, setHeld] = useState<ThreadMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [laterHidden, setLaterHidden] = useState<boolean | null>(null);

  const shell = useQuery({ queryKey: ["pair", id], queryFn: () => loadShell(id), enabled: focused, refetchInterval: focused ? SHELL_MS : false, refetchOnWindowFocus: false });
  const view = shell.data;
  const refresh = useCallback(() => void shell.refetch(), [shell]);
  const crewId = view?.card?.crewId ?? null;
  useEffect(() => {
    if (!crewId) return;
    let on = true;
    void isPutAway(`arrived.${crewId}`).then((away) => on && setLaterHidden(away));
    return () => {
      on = false;
    };
  }, [crewId]);

  const lastSeen = useRef(0);
  const seen = useCallback(() => {
    lastSeen.current = Date.now();
    return markPairSeen(id).catch(() => undefined);
  }, [id]);
  const thread = useThread("pair", id, {
    meId: view?.meId,
    focused,
    onIncoming: () => {
      if (focused && Date.now() - lastSeen.current >= SEEN_MS) void seen();
    },
  });

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void seen();
      return () => {
        setFocused(false);
        void seen().then(() => queryClient.invalidateQueries({ queryKey: MY_CHATS_KEY }));
      };
    }, [seen]),
  );

  if (view === undefined && !shell.error) {
    return (
      <AppScreen scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }
  if (!view?.chat) {
    // Removed, called off, blocked, reported or hidden: the chat is gone for both.
    return (
      <AppScreen>
        <Heading>{ONE_ON_ONE_COPY.chatEnded}</Heading>
        {shell.error ? <Trouble what={failed("open this chat", shell.error)} onRetry={refresh} /> : null}
        <Button kind="quiet" label="Back to Connections" onPress={() => router.replace("/connections")} />
      </AppScreen>
    );
  }

  const { chat, card, meId } = view;
  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    try {
      await thread.post(body, () => sendPairMessage(id, meId, body));
    } catch (err) {
      setTrouble(failed("send that", err));
    }
  };
  const takeBack = (localId: string) => {
    const words = thread.takeBack(localId);
    if (words) setDraft((d) => (d.trim() ? `${words}\n${d}` : words));
  };
  const ends = card ? Date.parse(effectiveEnd(card.gathering.startsAt, card.gathering.endsAt)) : 0;
  const night = !!card && Date.now() >= Date.parse(card.gathering.startsAt) - 3 * 3_600_000 && Date.now() < ends;
  const on = !!card && ["forming", "spot_set", "live"].includes(card.state);
  const placeName = card?.plan.spotId ? card.spots.find((s) => s.id === card.plan.spotId)?.name ?? null : card?.plan.atEvent ? ONE_ON_ONE_COPY.atTheEvent : null;
  const planText = [placeName, card?.plan.timeNote].filter(Boolean).join(" · ");
  const mine = card?.arrived[meId];
  const leave = async (what: string, run: () => Promise<void>) => {
    setBusy(true);
    setTrouble(null);
    try {
      await run();
      void queryClient.invalidateQueries({ queryKey: MY_CHATS_KEY });
      router.replace("/connections");
    } catch (err) {
      setTrouble(failed(what, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppScreen footer={<Composer value={draft} onChangeText={setDraft} onSend={() => void send()} placeholder={SOLO_COPY.threadPlaceholder(chat.firstName)} ready={!!thread.messages} />}>
      <View style={styles.header}>
        <Tap accessibilityRole="button" accessibilityLabel={ONE_ON_ONE_COPY.seeProfile} onPress={() => router.push(`/person/${chat.personId}`)} style={styles.who}>
          <Avatar name={chat.firstName} source={view.photoUrl} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={styles.headTitle} numberOfLines={1}>{card && on ? SOLO_COPY.planHeading(chat.firstName) : chat.firstName}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {card ? [ONE_ON_ONE_COPY.oneOnOneAt(card.gathering.name), planText].filter(Boolean).join(" · ") : ONE_ON_ONE_COPY.seeProfile}
            </Text>
          </View>
        </Tap>
        <Tap accessibilityRole="button" accessibilityLabel="More" onPress={() => setMenu(true)} style={styles.more}>
          <Text style={styles.moreLabel}>•••</Text>
        </Tap>
      </View>

      {trouble ? <Trouble what={trouble} onRetry={refresh} busy={busy} /> : null}

      {/* The 1-on-1's one optional line: A17 after the night, "I've arrived" on it, else the
          optional place or time. */}
      {card?.state === "done" ? (
        <Tap accessibilityRole="button" onPress={() => router.push({ pathname: "/after/[slug]", params: { slug: card.gathering.slug } })} style={styles.line}>
          <Text style={styles.lineText} numberOfLines={1}>
            {`${AFTER_COPY.finished} `}
            <Text style={styles.lineLink}>{AFTER_COPY.howDidItGo}</Text>
          </Text>
        </Tap>
      ) : card && on && night && laterHidden === false ? (
        <ImHere
          slim
          gatheringId={card.gathering.id}
          note={mine ? mine.note ?? "" : null}
          people={card.arrived[chat.personId] ? [{ personId: chat.personId, firstName: chat.firstName, note: card.arrived[chat.personId]!.note ?? "" }] : []}
          count={Object.keys(card.arrived).length}
          onChanged={refresh}
          onLater={() => {
            setLaterHidden(true);
            void putAway(`arrived.${card.crewId}`);
          }}
        />
      ) : null}
      {card && on ? (
        <SoloPlace
          crewId={card.crewId}
          spots={card.spots}
          spotId={card.plan.spotId}
          atEvent={card.plan.atEvent}
          timeNote={card.plan.timeNote}
          onChanged={refresh}
          open={placeOpen}
          onOpenChange={setPlaceOpen}
          row={!(night && laterHidden === false)}
        />
      ) : null}

      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <Text style={styles.headTitle}>{chat.firstName}</Text>
        <Button kind="quiet" label={ONE_ON_ONE_COPY.seeProfile} onPress={() => { setMenu(false); router.push(`/person/${chat.personId}`); }} />
        {card && on ? (
          <Button kind="quiet" label={ONE_ON_ONE_COPY.addPlace} onPress={() => { setMenu(false); setTimeout(() => setPlaceOpen(true), Platform.OS === "ios" ? 350 : 0); }} />
        ) : null}
        {card && on && night && laterHidden === true ? (
          <Button kind="quiet" label={HERE_COPY.label} onPress={() => { setLaterHidden(false); setMenu(false); }} />
        ) : null}
        {card && on ? (
          <>
            <Button kind="quiet" label={SOLO_COPY.callOff} busy={busy} onPress={() => { setMenu(false); void leave("call off the 1-on-1", async () => { const { error } = await supabase().rpc("leave_group", { p_crew: card.crewId }); if (error) throw error; }); }} />
            <Body muted>{SOLO_COPY.callOffNote}</Body>
          </>
        ) : (
          <>
            <Button kind="quiet" label={ONE_ON_ONE_COPY.removeConnection} busy={busy} onPress={() => { setMenu(false); void leave("remove the connection", () => removeConnection(chat.personId)); }} />
            <Body muted>{ONE_ON_ONE_COPY.removeNote}</Body>
          </>
        )}
        <Button kind="quiet" label="Close" onPress={() => setMenu(false)} />
      </Sheet>

      {thread.error ? <Trouble what={failed("open this chat", thread.error)} onRetry={thread.retry} /> : null}
      {thread.messages ? (
        thread.messages.length === 0 ? (
          <Body muted>{ONE_ON_ONE_COPY.firstLine}</Body>
        ) : (
          <ThreadMessages
            messages={thread.messages}
            meId={meId}
            nameOf={(a) => (a === meId ? "You" : chat.firstName)}
            faceOf={(a) => (a === meId ? null : view.photoUrl)}
            hasOlder={thread.hasOlder}
            olderBusy={thread.olderBusy}
            onOlder={() => void thread.loadOlder().catch((err) => setTrouble(failed("load earlier messages", err)))}
            onTakeBack={takeBack}
            onLongPress={(m) => (m.authorId === meId ? undefined : setHeld(m))}
          />
        )
      ) : !thread.error ? (
        <ActivityIndicator style={{ marginTop: spacing.lg }} color={palette.textMuted} />
      ) : null}

      {held ? (
        <MessageSheet
          held={held}
          mine={false}
          authorName={chat.firstName}
          onReport={(reason) => {
            setHeld(null);
            void leave("report that", () => reportPerson(meId, chat.personId, reason));
          }}
          onCancel={() => setHeld(null)}
        />
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.sm, marginBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border },
  who: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, minHeight: 44 },
  headTitle: { fontFamily: fonts.headline, fontSize: 18, color: palette.text },
  meta: { fontSize: 12, color: palette.textMuted },
  more: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  moreLabel: { fontSize: 18, color: palette.text, letterSpacing: 1 },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, borderBottomWidth: 1, borderBottomColor: palette.border },
  lineText: { fontSize: 15, color: palette.text },
  lineLink: { fontFamily: fonts.headline, color: palette.accentText },
});
