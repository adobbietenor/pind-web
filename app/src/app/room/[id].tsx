// A10 — the room (M3.3; build plan §8 M3.3, "The room at 1, 2, 3 and 5").
//
// Everyone open to meeting at a gathering, in one conversation, from the second person
// on. **It never opens on an empty thread, and nobody is asked to go first cold:**
//   * each person arrives as a card — face, name, neighbourhood, three tags — with the
//     tags you share marked; the cards fold into a strip at 5 in the room, you included;
//   * until you have posted, three openers sit over the box. Tapping one FILLS THE BOX,
//     editable; nothing is ever sent for you (S29);
//   * at 3, once: "enough to go together", and the way to squads (M3.7) — open to join,
//     on the crowd page (A15). Invite-only groups and "Go together" are retired;
//   * on the iPhone, the "Turn on" card for push — never at launch (lib/push.ts).
// Long-press your own message to delete it; anyone else's to report THEM — a report on
// the person, with where and when, never on the message (H9; Alex, 16 Oct 2026).
//
// **Two parts since the thread pass (16 Oct 2026):** the shell (lib/room.ts — who is
// here, read on opening and every minute) and the thread (lib/thread.ts — the messages,
// changed one row at a time by Realtime, by Send and by a cheap "since" poll). A message
// never reloads the shell. The box is the shared Composer in AppScreen's footer, so it
// stays on the keyboard, and Enter sends.
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { colors as palette, fonts, GO_TOGETHER_AT, NEIGHBOURHOODS, openersFor, radius, ROOM_COPY, spacing, SQUAD_COPY, WOMEN_ONLY_COPY, type ThreadMessage } from "@pind/shared";
import { Sheet, SideScroll } from "@/components/Sheet";
import { Avatar, AvatarStack } from "@/components/Avatar";
import { HouseRules } from "@/components/HouseRules";
import { Icon } from "@/components/Icon";
import { PersonSheet, type SheetPerson } from "@/components/PersonSheet";
import { leaveWomenOnlyRoom } from "@/lib/after";
import { AppScreen } from "@/components/AppScreen";
import { Composer } from "@/components/Composer";
import { MessageSheet } from "@/components/MessageSheet";
import { PushAsk } from "@/components/PushAsk";
import { ThreadMessages } from "@/components/ThreadMessages";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { failed, rateRefusal, type Described } from "@/lib/errors";
import { deleteRoomMessage, loadRoomShell, markSeen, reportFromMessage, sendRoomMessage, sharedTag, tagName, type Member } from "@/lib/room";
import { MY_CHATS_KEY } from "@/lib/myevents";
import { queryClient } from "@/lib/query";
import { faceSource } from "@/lib/signed-photos";
import { useThread } from "@/lib/thread";
import { Tap } from "@/components/Tap";
import { Rise } from "@/components/Motion";

const hoodName = (slug: string | null) => NEIGHBOURHOODS.find((n) => n.slug === slug)?.name ?? null;
// "Enough to go together" appears once per room (build plan §8 M3.3): marked seen on this
// device the first time it shows, like "Get the app".
const goKey = (roomId: string) => `pind.go-together.${roomId}`;
async function goSeen(roomId: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(goKey(roomId)) === "1";
    return (await SecureStore.getItemAsync(goKey(roomId))) === "1";
  } catch {
    return false;
  }
}
async function markGoSeen(roomId: string): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(goKey(roomId), "1");
    else await SecureStore.setItemAsync(goKey(roomId), "1");
  } catch {
    // Not remembered: it shows again next time, which is the lesser fault.
  }
}

// The shell's slow timer: new arrivals, the mix, and faces re-signed before their URLs lapse.
const SHELL_MS = 60_000;
// "I've looked": at most this often while messages arrive and the room is in view (#6
// waits two minutes from the last look, so a reader is never told about what they're reading).
const SEEN_MS = 60_000;

function Face({ member, style }: { member: Member; style: object }) {
  return member.photoUrl && member.photoPath ? (
    <Image source={faceSource(member.photoUrl, member.photoPath)} style={style} />
  ) : (
    <View style={[style, styles.faceEmpty]} />
  );
}

export default function Room() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [draft, setDraft] = useState("");
  const [sendNote, setSendNote] = useState("");
  const [held, setHeld] = useState<ThreadMessage | null>(null);
  // null until read: the card waits for the answer rather than flashing.
  const [goDismissed, setGoDismissed] = useState<boolean | null>(null);
  const [focused, setFocused] = useState(false);
  // The women-only room's Leave: asked once, then done.
  const [leavingWo, setLeavingWo] = useState(false);
  const [info, setInfo] = useState(false);
  const [sheet, setSheet] = useState<SheetPerson | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const shell = useQuery({
    queryKey: ["room", id],
    queryFn: () => loadRoomShell(id),
    enabled: focused,
    refetchInterval: focused ? SHELL_MS : false,
    refetchOnWindowFocus: false,
  });
  const view = shell.data;
  const { refetch: refetchShell } = shell;
  const refreshShell = useCallback(() => void refetchShell(), [refetchShell]);

  // Seen: when the room comes into view, then at most once a minute as messages arrive.
  const lastSeen = useRef(0);
  const seen = useCallback(() => {
    lastSeen.current = Date.now();
    return markSeen(id).catch(() => undefined);
  }, [id]);
  // A message from someone the shell has not met (they arrived since it was read): read
  // the shell once for them. Once — if RLS keeps them from me, asking again changes nothing.
  const asked = useRef(new Set<string>());
  const thread = useThread("room", id, {
    meId: view?.me.personId,
    focused,
    onIncoming: (m) => {
      if (focused && Date.now() - lastSeen.current >= SEEN_MS) void seen();
      if (view && !view.members.some((p) => p.personId === m.authorId) && !asked.current.has(m.authorId)) {
        asked.current.add(m.authorId);
        refreshShell();
      }
    },
  });

  useEffect(() => {
    let on = true;
    void goSeen(id).then((seen) => on && setGoDismissed(seen));
    return () => {
      on = false;
    };
  }, [id]);
  // Seen the moment it is shown — it stays for this visit, and never comes back.
  useEffect(() => {
    if (view && goDismissed === false && view.members.length + 1 === GO_TOGETHER_AT && !view.me.inGroup) void markGoSeen(id);
  }, [view, goDismissed, id]);

  // Seen when the room comes into view and when you leave it — then My Events and its
  // tab dot (A19) read afresh, so what you just read is no longer "unread".
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

  const shellTrouble = shell.error ? failed("open the room", shell.error) : null;
  const threadTrouble = thread.error ? failed("open the room", thread.error) : null;

  if (view === undefined && !shellTrouble) {
    return (
      <AppScreen scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }
  if (!view) {
    return (
      <AppScreen>
        <Heading>The room</Heading>
        {shellTrouble ? <Trouble what={shellTrouble} onRetry={refreshShell} /> : <Body muted>This room isn't open to you.</Body>}
      </AppScreen>
    );
  }

  const people = view.members;
  const count = people.length + 1;
  // **Only at exactly the number it describes** (UI pass 1): "There are three of you" is
  // said at three, never at four or forty.
  const showGo = count === GO_TOGETHER_AT && goDismissed === false && !view.me.inGroup;
  const faceOf = (m: Member | undefined) => (m?.photoUrl && m.photoPath ? faceSource(m.photoUrl, m.photoPath) : null);
  const open = (p: Member) =>
    setSheet({ id: p.personId, firstName: p.firstName, photo: faceOf(p), area: hoodName(p.neighbourhood), tags: p.tags.map(tagName).filter(Boolean) as string[] });
  const byId = new Map(people.map((p) => [p.personId, p]));
  const closed = Date.now() >= Date.parse(view.gathering.closesAt);
  const firstShared = people.map((p) => sharedTag(view.me.tags, p.tags)).find(Boolean) ?? null;
  const openers = openersFor({ convening: view.gathering.convening, sharedTag: firstShared });
  const messages = thread.messages ?? [];
  // "Posted" is the shell's record, or a message of mine on its way: the openers go the
  // moment I send, and come back if it fails.
  const posted = view.me.posted || messages.some((m) => m.authorId === view.me.personId && m.status !== "failed");

  // The box is cleared and the message is on screen at once; the insert confirms it.
  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    setSendNote("");
    try {
      await thread.post(body, () => sendRoomMessage(view.roomId, view.me.personId, body));
    } catch (err) {
      const why = rateRefusal(err);
      if (why) setSendNote(why === "too-many" ? ROOM_COPY.tooMany : ROOM_COPY.tooFast);
      else setTrouble(failed("send that", err));
    }
  };
  // A failed message, back in the box: the person sends it again, or doesn't (S29).
  const takeBack = (localId: string) => {
    const words = thread.takeBack(localId);
    if (words) setDraft((d) => (d.trim() ? `${words}\n${d}` : words));
  };

  return (
    <AppScreen
      footer={
        closed ? (
          <Notice>{ROOM_COPY.readOnly}</Notice>
        ) : (
          <Composer
            value={draft}
            onChangeText={setDraft}
            onSend={() => void send()}
            placeholder={ROOM_COPY.placeholder}
            note={sendNote}
            ready={!!thread.messages}
            // Openers until you've said something, just over the box: they fill it, never send it.
            chips={!posted && thread.messages ? openers : undefined}
          />
        )
      }
    >
      {/* The room's header (UI pass 1, 057): its faces, its name, the event and how many
          are here, and the info button, which holds the house rules and the rest. */}
      <View style={styles.header}>
        <AvatarStack size={30} max={3} people={people.map((p) => ({ id: p.personId, name: p.firstName, source: faceOf(p) }))} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{view.womenOnly ? WOMEN_ONLY_COPY.room : ROOM_COPY.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{`${view.gathering.name} · ${ROOM_COPY.here(count)}`}</Text>
        </View>
        <Tap accessibilityRole="button" accessibilityLabel={ROOM_COPY.about} onPress={() => setInfo(true)} style={styles.infoButton}>
          <Icon name="info" size={22} color={palette.text} />
        </Tap>
      </View>

      {/* Everyone here, a face each, you last. Tap anyone for their profile sheet. */}
      <SideScroll>
        {people.map((p) => (
          <Tap key={p.personId} accessibilityRole="button" accessibilityLabel={p.firstName} onPress={() => open(p)} style={styles.faceCell}>
            <Avatar name={p.firstName} source={faceOf(p)} size={52} />
            <Text style={styles.faceName} numberOfLines={1}>{p.firstName}</Text>
          </Tap>
        ))}
        <View style={styles.faceCell}>
          <View style={styles.you}>
            <Text style={styles.youLabel}>You</Text>
          </View>
          <Text style={styles.faceName}>You</Text>
        </View>
      </SideScroll>

      <Sheet visible={info} onClose={() => setInfo(false)}>
            <Text style={styles.title}>{ROOM_COPY.about}</Text>
            <Body muted>{`${view.gathering.name} · ${ROOM_COPY.inRoom(count)}`}</Body>
            {/* At 5, the mix (Q3's floor): the gathering's public numbers, never the room's own. */}
            {count >= 5 && view.mix ? <Body muted>{view.mix}</Body> : null}
            <HouseRules />
            <PushAsk />
      {/* The women-only room's Leave (M4.2): you stay in the general room, and nobody is told. */}
      {view.womenOnly && !closed ? (
        leavingWo ? (
          <View style={styles.go}>
            <Body>{WOMEN_ONLY_COPY.leaveWhat}</Body>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={WOMEN_ONLY_COPY.leaveConfirm}
                  busy={busy === "leave-wo"}
                  onPress={async () => {
                    setBusy("leave-wo");
                    try {
                      await leaveWomenOnlyRoom(view.gathering.id);
                      void queryClient.invalidateQueries({ queryKey: MY_CHATS_KEY });
                      router.replace({ pathname: "/crowd/[slug]", params: { slug: view.gathering.slug } });
                    } catch (err) {
                      setTrouble(failed("leave the women-only room", err));
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button kind="quiet" label={WOMEN_ONLY_COPY.stay} onPress={() => setLeavingWo(false)} />
              </View>
            </View>
          </View>
        ) : (
          <Button kind="quiet" label={WOMEN_ONLY_COPY.leave} onPress={() => setLeavingWo(true)} />
        )
      ) : null}
            <Button kind="quiet" label="Close" onPress={() => setInfo(false)} />
      </Sheet>
      <PersonSheet
        person={sheet}
        onClose={() => setSheet(null)}
        onProfile={() => {
          const pid = sheet?.id;
          setSheet(null);
          if (pid) router.push(`/person/${pid}`);
        }}
      />

      {/* At 3, once: the next step, never pushed. */}
      {showGo ? (
        <View style={styles.go}>
          <Body>{ROOM_COPY.enoughToGo}</Body>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label={SQUAD_COPY.start} onPress={() => router.push({ pathname: "/crowd/[slug]", params: { slug: view.gathering.slug } })} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="quiet" label="Later" onPress={() => setGoDismissed(true)} />
            </View>
          </View>
        </View>
      ) : null}

      {/* An action that failed (delete, report, a page of history): "Try again" reads the room afresh, as it always did. */}
      {trouble ? (
        <Trouble
          what={trouble}
          onRetry={() => {
            setTrouble(null);
            refreshShell();
            thread.recheck();
          }}
        />
      ) : null}
      {threadTrouble ? <Trouble what={threadTrouble} onRetry={thread.retry} /> : null}

      {/* The conversation: a page at a time, mine on screen the moment I send. */}
      {thread.messages ? (
        <ThreadMessages
          messages={messages}
          meId={view.me.personId}
          nameOf={(a) => byId.get(a)?.firstName ?? "Someone"}
          faceOf={(a) => faceOf(byId.get(a))}
          hasOlder={thread.hasOlder}
          olderBusy={thread.olderBusy}
          onOlder={() => void thread.loadOlder().catch((err) => setTrouble(failed("load earlier messages", err)))}
          onTakeBack={takeBack}
          onLongPress={setHeld}
        />
      ) : !threadTrouble ? (
        <ActivityIndicator style={{ marginTop: spacing.lg }} color={palette.textMuted} />
      ) : null}

      {/* Long-press: delete your own; anyone else's reports THEM, never the message (two taps, H9). */}
      {held ? (
        <MessageSheet
          held={held}
          mine={held.authorId === view.me.personId}
          authorName={byId.get(held.authorId)?.firstName ?? "them"}
          onDelete={async () => {
            const gone = await deleteRoomMessage(held.id).then(
              () => true,
              (err) => {
                setTrouble(failed("delete that", err));
                return false;
              },
            );
            if (gone) thread.forget(held.id);
            setHeld(null);
          }}
          onReport={async (reason) => {
            await reportFromMessage(view.me.personId, held, { roomId: view.roomId }, reason).catch((err) => setTrouble(failed("report that", err)));
            setHeld(null);
            // A safety reason hides them at once, and their messages with them: look now.
            thread.recheck();
            refreshShell();
          }}
          onCancel={() => setHeld(null)}
        />
      ) : null}

    </AppScreen>
  );
}

const styles = StyleSheet.create({
  arrival: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border },
  face: { width: 44, height: 44, borderRadius: 22 },
  faceEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  name: { fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  meta: { fontSize: 13, color: palette.textMuted },
  shared: { fontSize: 13, color: palette.accentText, marginTop: 2 },
  strip: { flexDirection: "row", alignItems: "center", gap: 4, marginVertical: spacing.sm },
  stripFace: { width: 28, height: 28, borderRadius: 14 },
  go: { padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, marginTop: spacing.md, gap: spacing.sm },
  opener: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderWidth: 1, borderColor: palette.accent, borderRadius: 999 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border },
  title: { fontFamily: fonts.headline, fontSize: 18, color: palette.text },
  infoButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  faceCell: { alignItems: "center", gap: 4, width: 60 },
  faceName: { fontSize: 13, color: palette.textMuted },
  you: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: "#2A2236" },
  youLabel: { fontFamily: fonts.headline, fontSize: 15, color: palette.accentText },

  openerText: { fontSize: 14, color: palette.text },
});
