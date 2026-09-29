// A11 — your small group (M3.3; build plan §8 M3.3, and Alex's inviter's-screen design).
//
// **Progress without attribution** (Alex): while under 3 the card says who is in, by
// name — never who hasn't answered or who said no. "2 of 3" is not used: after a
// decline it either stays put (untrue) or moves (it names the decliner).
//   * forming: "You and Bo so far — a group needs 3", the deadline from the start
//     ("If there aren't 3 of you by 5:00 pm…"), and "Invite someone else you've talked
//     with" (invite_more, while under 3);
//   * on, a spot first: the poll — vote, and three hours before the leader is the plan;
//   * the plan: "You meet at Spot B, 6:00 pm", or "You'll find each other at the start";
//   * live: "I'm here", with a line so they can find you (Q7, never geofenced);
//   * closed under 3: said plainly, with the way back into the room.
// Everything here is readable by the group's members only (V21).
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { colors as palette, fonts, GROUP_COPY, radius, shareCardUrl, SHARE_COPY, spacing, type Convening } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Field, Heading, Notice } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { readProfile } from "@/lib/profile";
import { loadRoom, sendGroupMessage, type Member } from "@/lib/room";
import { supabase } from "@/lib/supabase";

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";

// "Share spot & time with a friend" (W3): the phone's share sheet; on a browser without
// one, the link is copied and the button says so, where the tap was.
async function shareCard(text: string, url: string): Promise<"shared" | "copied" | "failed"> {
  if (Platform.OS !== "web") {
    await Share.share({ message: `${text}
${url}` });
    return "shared";
  }
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav?.share) {
    await nav.share({ text, url }).catch(() => undefined);
    return "shared";
  }
  return nav?.clipboard ? nav.clipboard.writeText(url).then(() => "copied" as const, () => "failed" as const) : "failed";
}

const clock = (iso: string) => new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const dayClock = (iso: string) => new Intl.DateTimeFormat("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

interface GroupView {
  id: string;
  state: "forming" | "spot_set" | "live" | "done" | "dissolved";
  gathering: { id: string; name: string; slug: string; startsAt: string };
  convening: Convening;
  roomId: string | null;
  meId: string;
  members: { personId: string; firstName: string; photoUrl: string | null; arrivedAt: string | null; arrivalNote: string | null }[];
  closesAt: string | null;
  spot: string | null;
  meetAt: string | null;
  proposals: { id: string; spot: string; meetAt: string; votes: number; mine: boolean }[];
  messages: { id: string; authorId: string; body: string; createdAt: string }[];
}

async function loadGroup(id: string): Promise<GroupView | null> {
  const db = supabase();
  const me = await readProfile();
  if (!me.personId) return null;
  const { data: c, error } = await db.from("crews").select("id, state, gathering_id, room_id, spot_id, meet_at").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!c) return null;
  const [g, conv, mem, props, votes, msgs, closes, spot] = await Promise.all([
    db.from("gatherings").select("id, name, slug, starts_at").eq("id", c.gathering_id).maybeSingle(),
    db.rpc("convening_of", { p_gathering: c.gathering_id }),
    db.from("crew_members").select("person_id, arrived_at, arrival_note, left_at").eq("crew_id", id),
    db.from("crew_proposals").select("id, spot_id, meet_at, meeting_spots(name)").eq("crew_id", id),
    db.from("crew_proposal_votes").select("proposal_id, person_id"),
    db.from("crew_messages").select("id, author_id, body, created_at, kind").eq("crew_id", id).order("created_at").limit(300),
    db.rpc("group_closes_at", { p_crew: id }),
    c.spot_id ? db.from("meeting_spots").select("name").eq("id", c.spot_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!g.data) return null;
  const active = (mem.data ?? []).filter((m) => !m.left_at);
  const ids = active.map((m) => m.person_id);
  const { data: people } = await db.from("people").select("id, first_name, photo_path").in("id", ids);
  const paths = (people ?? []).map((p) => p.photo_path).filter((x): x is string => !!x);
  const signed = paths.length ? (await db.storage.from("photos").createSignedUrls(paths, 300)).data ?? [] : [];
  const urlFor = new Map(signed.filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));
  const myProps = new Set((props.data ?? []).map((p) => p.id));
  const v = (votes.data ?? []).filter((x) => myProps.has(x.proposal_id));
  return {
    id,
    state: c.state as GroupView["state"],
    gathering: { id: g.data.id, name: g.data.name, slug: g.data.slug ?? g.data.id, startsAt: g.data.starts_at },
    convening: (conv.data as Convening) ?? "a_spot_first",
    roomId: c.room_id,
    meId: me.personId,
    members: active.map((m) => {
      const p = (people ?? []).find((x) => x.id === m.person_id);
      return {
        personId: m.person_id,
        firstName: p?.first_name ?? "Someone",
        photoUrl: p?.photo_path ? urlFor.get(p.photo_path) ?? null : null,
        arrivedAt: m.arrived_at,
        arrivalNote: m.arrival_note,
      };
    }),
    closesAt: (closes.data as string | null) ?? null,
    spot: (spot.data as { name: string } | null)?.name ?? null,
    meetAt: c.meet_at,
    proposals: (props.data ?? []).map((p) => ({
      id: p.id,
      spot: (p as unknown as { meeting_spots: { name: string } | null }).meeting_spots?.name ?? "A spot",
      meetAt: p.meet_at,
      votes: v.filter((x) => x.proposal_id === p.id).length,
      mine: v.some((x) => x.proposal_id === p.id && x.person_id === me.personId),
    })),
    messages: (msgs.data ?? []).filter((m) => m.kind !== "system").map((m) => ({ id: m.id, authorId: m.author_id ?? "", body: m.body, createdAt: m.created_at })),
  };
}

export default function Group() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [view, setView] = useState<GroupView | null | undefined>(undefined);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [shared, setShared] = useState<"shared" | "copied" | "failed" | null>(null);
  const [inviting, setInviting] = useState(false);
  const [roomPeople, setRoomPeople] = useState<Member[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    loadGroup(id)
      .then(setView)
      .catch((err) => {
        setTrouble(failed("open your group", err));
        setView((v) => v ?? null);
      });
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      refresh();
      const poll = setInterval(refresh, 15_000);
      return () => clearInterval(poll);
    }, [refresh]),
  );
  useEffect(() => {
    const channel = supabase()
      .channel(`group:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crew_messages", filter: `crew_id=eq.${id}` }, () => refresh())
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
        <Heading>{GROUP_COPY.heading}</Heading>
        {trouble ? <Trouble what={trouble} onRetry={refresh} /> : <Body muted>This group isn't yours to see.</Body>}
      </AppScreen>
    );
  }

  const others = view.members.filter((m) => m.personId !== view.meId);
  const names = others.map((m) => m.firstName);
  const me = view.members.find((m) => m.personId === view.meId);
  const act = async (what: string, run: () => PromiseLike<{ error: unknown }>) => {
    setBusy(true);
    setTrouble(null);
    const { error } = await run();
    setBusy(false);
    if (error) setTrouble(failed(what, error));
    refresh();
  };

  const openInvite = async () => {
    setInviting(true);
    if (view.roomId) {
      const room = await loadRoom(view.roomId).catch(() => null);
      const inGroup = new Set(view.members.map((m) => m.personId));
      setRoomPeople((room?.members ?? []).filter((p) => p.posted && !inGroup.has(p.personId)));
    }
  };

  return (
    <AppScreen>
      <Heading>{GROUP_COPY.heading}</Heading>
      <Body muted>{view.gathering.name}</Body>

      <View style={styles.faces}>
        {view.members.map((m) =>
          m.photoUrl ? <Image key={m.personId} source={{ uri: m.photoUrl }} style={styles.face} /> : <View key={m.personId} style={[styles.face, styles.faceEmpty]} />,
        )}
      </View>

      {trouble ? <Trouble what={trouble} onRetry={refresh} busy={busy} /> : null}

      {view.state === "dissolved" ? (
        <View style={styles.card}>
          <Body>{GROUP_COPY.closed}</Body>
          {view.roomId ? <Button label={GROUP_COPY.closedNext} onPress={() => router.replace({ pathname: "/room/[id]", params: { id: view.roomId! } })} /> : null}
        </View>
      ) : view.state === "forming" && view.members.length < 3 ? (
        <View style={styles.card}>
          <Body>{GROUP_COPY.soFar(names)}</Body>
          {view.closesAt ? <Body muted>{GROUP_COPY.deadline(dayClock(view.closesAt))}</Body> : null}
          {!inviting ? (
            <Button kind="quiet" label={GROUP_COPY.inviteMore} onPress={() => void openInvite()} />
          ) : (
            <>
              <Body muted>{GROUP_COPY.pickHint}</Body>
              {roomPeople.map((p) => {
                const on = picked.includes(p.personId);
                return (
                  <Pressable key={p.personId} onPress={() => setPicked(on ? picked.filter((x) => x !== p.personId) : [...picked, p.personId].slice(0, 3))} style={[styles.pick, on && styles.pickOn]}>
                    <Text style={styles.name}>{p.firstName}</Text>
                  </Pressable>
                );
              })}
              <Button
                label={GROUP_COPY.start}
                disabled={picked.length === 0}
                busy={busy}
                onPress={() => void act("send the invites", () => supabase().rpc("invite_more", { p_crew: view.id, p_invitees: picked })).then(() => { setInviting(false); setPicked([]); })}
              />
            </>
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Body>{GROUP_COPY.on(names)}</Body>
          {view.state === "forming" && view.convening !== "at_the_gathering" ? (
            <>
              <Text style={styles.section}>{GROUP_COPY.pollHeading}</Text>
              <Body muted>{GROUP_COPY.pollHint}</Body>
              {view.proposals.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() =>
                    void act("vote", () =>
                      p.mine
                        ? supabase().from("crew_proposal_votes").delete().eq("proposal_id", p.id).eq("person_id", view.meId)
                        : supabase().from("crew_proposal_votes").insert({ proposal_id: p.id, person_id: view.meId }),
                    )
                  }
                  style={[styles.pick, p.mine && styles.pickOn]}
                >
                  <Text style={styles.name}>{`${p.spot} · ${clock(p.meetAt)}`}</Text>
                  <Text style={styles.meta}>{`${p.votes} ${p.votes === 1 ? "vote" : "votes"}`}</Text>
                </Pressable>
              ))}
            </>
          ) : view.meetAt ? (
            <>
              <Body>{view.spot ? GROUP_COPY.meets(view.spot, dayClock(view.meetAt)) : GROUP_COPY.atTheStart}</Body>
              <Button
                kind="quiet"
                label={shared === "copied" ? "Link copied" : shared === "failed" ? "Couldn't share — try again" : SHARE_COPY.button}
                onPress={async () => {
                  const url = shareCardUrl(SITE, view.gathering.slug, view.spot, view.meetAt);
                  setShared(await shareCard(SHARE_COPY.message(view.gathering.name, view.spot, view.meetAt ? dayClock(view.meetAt) : null), url).catch(() => "failed" as const));
                }}
              />
            </>
          ) : null}
        </View>
      )}

      {/* The night: "I'm here", with a line so they can find you (Q7). */}
      {view.state === "live" && me ? (
        <View style={styles.card}>
          {me.arrivedAt ? (
            <Body>{`You're here — "${me.arrivalNote}"`}</Body>
          ) : (
            <>
              <Field label={GROUP_COPY.here} hint={GROUP_COPY.hereHint} value={note} onChangeText={setNote} maxLength={80} />
              <Button
                label={GROUP_COPY.here}
                disabled={!note.trim()}
                busy={busy}
                onPress={() =>
                  void act("say you're here", () =>
                    supabase().from("crew_members").update({ arrived_at: new Date().toISOString(), arrival_note: note.trim() }).eq("crew_id", view.id).eq("person_id", view.meId),
                  )
                }
              />
            </>
          )}
          {others.filter((m) => m.arrivedAt).map((m) => (
            <Body key={m.personId} muted>{`${m.firstName} is here — "${m.arrivalNote}"`}</Body>
          ))}
        </View>
      ) : null}

      {/* The group's own thread. */}
      {view.state !== "dissolved" ? (
        <>
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {view.messages.map((m) => {
              const mine = m.authorId === view.meId;
              const who = mine ? "You" : view.members.find((x) => x.personId === m.authorId)?.firstName ?? "Someone";
              return (
                <View key={m.id} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  <Text style={styles.meta}>{`${who} · ${clock(m.createdAt)}`}</Text>
                  <Text style={styles.body}>{m.body}</Text>
                </View>
              );
            })}
          </View>
          <View style={{ marginTop: spacing.md }}>
            <TextInput value={draft} onChangeText={setDraft} placeholder={GROUP_COPY.threadPlaceholder} placeholderTextColor={palette.tabInactive} maxLength={500} multiline style={styles.input} />
            <Button
              label="Send"
              disabled={!draft.trim()}
              busy={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await sendGroupMessage(view.id, view.meId, draft);
                  setDraft("");
                } catch (err) {
                  setTrouble(failed("send that", err));
                } finally {
                  setBusy(false);
                  refresh();
                }
              }}
            />
          </View>
          <View style={{ marginTop: spacing.lg }}>
            <Button kind="quiet" label={GROUP_COPY.leave} onPress={() => void act("leave the group", () => supabase().rpc("leave_group", { p_crew: view.id })).then(() => { if (view.roomId) router.replace({ pathname: "/room/[id]", params: { id: view.roomId } }); })} />
          </View>
        </>
      ) : null}
      {view.state === "done" ? <Notice>This gathering has finished.</Notice> : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  faces: { flexDirection: "row", gap: 6, marginVertical: spacing.md },
  face: { width: 44, height: 44, borderRadius: 22 },
  faceEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  card: { padding: spacing.md, borderWidth: 1, borderColor: palette.accent, borderRadius: radius.md, backgroundColor: palette.surface, gap: spacing.sm, marginBottom: spacing.md },
  section: { fontFamily: fonts.headline, fontSize: 15, color: palette.text, marginTop: spacing.sm },
  pick: { padding: spacing.sm, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  pickOn: { borderColor: palette.accent, backgroundColor: palette.background },
  name: { fontFamily: fonts.headline, fontSize: 15, color: palette.text },
  meta: { fontSize: 12, color: palette.textMuted },
  bubble: { padding: spacing.sm, borderRadius: radius.md, maxWidth: "88%" },
  mine: { alignSelf: "flex-end", backgroundColor: palette.accent },
  theirs: { alignSelf: "flex-start", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  body: { fontSize: 15, color: palette.text },
  input: { minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.sm, color: palette.text, backgroundColor: palette.surface, marginBottom: spacing.sm, fontSize: 15 },
});
