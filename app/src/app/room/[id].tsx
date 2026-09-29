// A10 — the room (M3.3; build plan §8 M3.3, "The room at 1, 2, 3 and 5").
//
// Everyone open to meeting at a gathering, in one conversation, from the second person
// on. **It never opens on an empty thread, and nobody is asked to go first cold:**
//   * each person arrives as a card — face, name, neighbourhood, three tags — with the
//     tags you share marked; past four, the cards fold into a strip;
//   * until you have posted, three openers sit over the box. Tapping one FILLS THE BOX,
//     editable; nothing is ever sent for you (S29);
//   * at 3, once: "enough to go together", and "Go together" invites 2 or 3 people you
//     have both posted with (the database checks it; P150);
//   * on the iPhone, the "Turn on" card for push — never at launch (lib/push.ts).
// Long-press your own message to delete it; anyone else's to report it (H9).
// Realtime through postgres_changes, which respects RLS; a 15-second poll is the net.
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors as palette, fonts, GROUP_COPY, NEIGHBOURHOODS, openersFor, radius, REPORT_REASONS, ROOM_COPY, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { PushAsk } from "@/components/PushAsk";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { failed, rateRefusal, type Described } from "@/lib/errors";
import { deleteRoomMessage, loadRoom, markSeen, reportRoomMessage, sendRoomMessage, sharedTag, tagName, type Message, type RoomView } from "@/lib/room";
import { supabase } from "@/lib/supabase";

const hoodName = (slug: string | null) => NEIGHBOURHOODS.find((n) => n.slug === slug)?.name ?? null;
const clock = (iso: string) => new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export default function Room() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [view, setView] = useState<RoomView | null | undefined>(undefined);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState("");
  const [held, setHeld] = useState<Message | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [goDismissed, setGoDismissed] = useState(false);
  const live = useRef(true);

  const refresh = useCallback(() => {
    loadRoom(id)
      .then((v) => {
        if (!live.current) return;
        setView(v);
        void markSeen(id);
      })
      .catch((err) => {
        setTrouble(failed("open the room", err));
        setView((v) => v ?? null);
      });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      live.current = true;
      refresh();
      const poll = setInterval(refresh, 15_000);
      return () => {
        live.current = false;
        clearInterval(poll);
      };
    }, [refresh]),
  );

  // New messages arrive live (RLS decides who receives each one).
  useEffect(() => {
    const channel = supabase()
      .channel(`room:${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${id}` }, () => refresh())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "room_messages" }, () => refresh())
      .subscribe();
    return () => {
      void supabase().removeChannel(channel);
    };
  }, [id, refresh]);

  if (view === undefined) {
    return (
      <AppScreen scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }
  if (view === null) {
    return (
      <AppScreen>
        <Heading>The room</Heading>
        {trouble ? <Trouble what={trouble} onRetry={refresh} /> : <Body muted>This room isn't open to you.</Body>}
      </AppScreen>
    );
  }

  const people = view.members;
  const count = people.length + 1;
  const byId = new Map(people.map((p) => [p.personId, p]));
  const closed = Date.now() >= Date.parse(view.gathering.closesAt);
  const firstShared = people.map((p) => sharedTag(view.me.tags, p.tags)).find(Boolean) ?? null;
  const openers = openersFor({ convening: view.gathering.convening, sharedTag: firstShared });
  const talked = people.filter((p) => p.posted);

  const send = async () => {
    if (!draft.trim()) return;
    setSending(true);
    setSendNote("");
    try {
      await sendRoomMessage(view.roomId, view.me.personId, draft);
      setDraft("");
      refresh();
    } catch (err) {
      const why = rateRefusal(err);
      if (why) setSendNote(why === "too-many" ? ROOM_COPY.tooMany : ROOM_COPY.tooFast);
      else setTrouble(failed("send that", err));
    } finally {
      setSending(false);
    }
  };

  const startGroup = async () => {
    setTrouble(null);
    const { data, error } = await supabase().rpc("start_group", { p_room: view.roomId, p_invitees: picked });
    if (error) return setTrouble(failed("send the invites", error));
    router.push({ pathname: "/group/[id]", params: { id: data as string } });
  };

  return (
    <AppScreen>
      <Heading>{view.gathering.name}</Heading>
      <Body muted>{view.womenOnly ? `Women-only room · ${ROOM_COPY.inRoom(count)}` : ROOM_COPY.inRoom(count)}</Body>

      <View style={{ marginTop: spacing.md }}>
        <PushAsk />
      </View>

      {/* The arrivals: who is here, with what you share. Past four, a strip. */}
      {people.length <= 4 ? (
        people.map((p) => {
          const shared = sharedTag(view.me.tags, p.tags);
          return (
            <Pressable key={p.personId} onPress={() => router.push(`/person/${p.personId}`)} style={styles.arrival}>
              {p.photoUrl ? <Image source={{ uri: p.photoUrl }} style={styles.face} /> : <View style={[styles.face, styles.faceEmpty]} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{`${p.firstName} ${ROOM_COPY.arrived}`}</Text>
                <Text style={styles.meta}>{[hoodName(p.neighbourhood), ...p.tags.map(tagName)].filter(Boolean).join(" · ")}</Text>
                {shared ? <Text style={styles.shared}>{ROOM_COPY.sharedTag(shared)}</Text> : null}
              </View>
            </Pressable>
          );
        })
      ) : (
        <View style={styles.strip}>
          {people.slice(0, 8).map((p) =>
            p.photoUrl ? <Image key={p.personId} source={{ uri: p.photoUrl }} style={styles.stripFace} /> : <View key={p.personId} style={[styles.stripFace, styles.faceEmpty]} />,
          )}
          <Text style={styles.meta}>{ROOM_COPY.morePeople(count)}</Text>
        </View>
      )}

      {/* At 3, once: the next step, never pushed. */}
      {count >= 3 && !goDismissed && !picking ? (
        <View style={styles.go}>
          <Body>{ROOM_COPY.enoughToGo}</Body>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label={ROOM_COPY.goTogether} onPress={() => setPicking(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="quiet" label="Later" onPress={() => setGoDismissed(true)} />
            </View>
          </View>
        </View>
      ) : null}

      {picking ? (
        <View style={styles.go}>
          <Body>{GROUP_COPY.pickPeople}</Body>
          {!view.me.posted ? (
            <Body muted>{ROOM_COPY.sayHiFirst}</Body>
          ) : (
            <>
              <Body muted>{GROUP_COPY.pickHint}</Body>
              {people.map((p) => {
                const on = picked.includes(p.personId);
                return (
                  <Pressable
                    key={p.personId}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: !p.posted }}
                    disabled={!p.posted}
                    onPress={() => setPicked(on ? picked.filter((x) => x !== p.personId) : [...picked, p.personId].slice(0, 3))}
                    style={[styles.pick, on && styles.pickOn, !p.posted && { opacity: 0.4 }]}
                  >
                    <Text style={styles.name}>{p.firstName}</Text>
                    {!p.posted ? <Text style={styles.meta}>hasn't said anything yet</Text> : null}
                  </Pressable>
                );
              })}
              <Button label={GROUP_COPY.start} disabled={picked.length < 2 || talked.length < 2} onPress={() => void startGroup()} />
            </>
          )}
          <Button kind="quiet" label="Cancel" onPress={() => setPicking(false)} />
        </View>
      ) : null}

      {trouble ? <Trouble what={trouble} onRetry={refresh} /> : null}

      {/* The conversation. */}
      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        {view.messages.map((m) => {
          const mine = m.authorId === view.me.personId;
          const who = mine ? "You" : byId.get(m.authorId)?.firstName ?? "Someone";
          return (
            <Pressable key={m.id} onLongPress={() => setHeld(m)} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text style={styles.who}>{`${who} · ${clock(m.createdAt)}`}</Text>
              <Text style={styles.body}>{m.body}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Long-press: delete your own, report anyone else's (two taps, H9). */}
      {held ? (
        <View style={styles.go}>
          {held.authorId === view.me.personId ? (
            <>
              <Body>{ROOM_COPY.deleteOwn}</Body>
              <Button
                label="Delete"
                onPress={async () => {
                  await deleteRoomMessage(held.id).catch((err) => setTrouble(failed("delete that", err)));
                  setHeld(null);
                  refresh();
                }}
              />
            </>
          ) : (
            <>
              <Body>{ROOM_COPY.report}</Body>
              {REPORT_REASONS.map((r) => (
                <Button
                  key={r.value}
                  kind="quiet"
                  label={r.label}
                  onPress={async () => {
                    await reportRoomMessage(view.me.personId, held.id, r.value).catch((err) => setTrouble(failed("report that", err)));
                    setHeld(null);
                    refresh();
                  }}
                />
              ))}
            </>
          )}
          <Button kind="quiet" label="Cancel" onPress={() => setHeld(null)} />
        </View>
      ) : null}

      {/* The box. Openers until you've said something: they fill it, never send it. */}
      {closed ? (
        <Notice>{ROOM_COPY.readOnly}</Notice>
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          {!view.me.posted ? (
            <View style={{ gap: spacing.xs, marginBottom: spacing.sm }}>
              {openers.map((o) => (
                <Pressable key={o} accessibilityRole="button" onPress={() => setDraft(o)} style={styles.opener}>
                  <Text style={styles.openerText}>{o}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={ROOM_COPY.placeholder}
            placeholderTextColor={palette.tabInactive}
            maxLength={500}
            multiline
            style={styles.input}
          />
          {sendNote ? <Body muted>{sendNote}</Body> : null}
          <Button label={ROOM_COPY.send} busy={sending} disabled={!draft.trim()} onPress={() => void send()} />
        </View>
      )}
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
  pick: { padding: spacing.sm, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  pickOn: { borderColor: palette.accent, backgroundColor: palette.background },
  bubble: { padding: spacing.sm, borderRadius: radius.md, maxWidth: "88%" },
  mine: { alignSelf: "flex-end", backgroundColor: palette.accent },
  theirs: { alignSelf: "flex-start", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  who: { fontSize: 12, color: palette.textMuted, marginBottom: 2 },
  body: { fontSize: 15, color: palette.text },
  opener: { paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.accent, borderRadius: 999, alignSelf: "flex-start" },
  openerText: { fontSize: 14, color: palette.text },
  input: { minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.sm, color: palette.text, backgroundColor: palette.surface, marginBottom: spacing.sm, fontSize: 15 },
});
