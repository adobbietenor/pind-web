// A11 — your squad (M3.7; until then your invite-only small group, M3.3), and A12, its plan.
//
//   * the card: who is in, by name; a squad is born with its spot and time, so there is
//     no forming state, no poll and no "invite someone else" (all retired with invites);
//   * the plan: "You meet at Spot B, 6:00 pm", or "You'll find each other at the start";
//   * live: "I'm here", with a line so they can find you (Q7, never geofenced);
//   * done (A17): finished, counted, and its one action is A16 "Who did you meet?".
// Everything here is readable by the group's members only (V21).
//
// **A squad (M3.7) is this screen**: its name as the heading, born with its spot and
// time, so no poll and no invites (both retired with invite-only groups); "I'm here", the
// thread and A17/A16 as before. A name still being checked, or refused, says so here too.
// Instagram handles are not shown in squads (decisions, "M3.7": share_crew is 1-on-1 only).
//
// **A 1-on-1 plan (A29, M3.4) is this screen too** — the same card, thread, "I'm here"
// and A17/A16 (spec A29). It is born with its spot and time, so it never shows the poll
// or "invite someone else"; leaving calls it off for both, and the other is told only
// that it is off.
//
// Long-press someone else's message to report THEM — a report on the person, with where
// and when, never on the message (H9; Alex, 16 Oct 2026). A safety reason hides them at
// once, which calls a 1-on-1 plan with them off.
//
// **The thread pass (16 Oct 2026):** the card is a shell, read on opening and every 30
// seconds (it carries "I'm here" on the night); the thread is lib/thread.ts, changed one
// row at a time — a message never reloads the card. The box is the shared Composer in
// AppScreen's footer, on the keyboard, and Enter sends. The thread is the last thing on
// the page, so its newest message sits directly over the box; "Leave" and A17 come before it.
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Platform, Share, StyleSheet, Text, View } from "react-native";
import { AFTER_COPY, colors as palette, effectiveEnd, fonts, GROUP_COPY, radius, shareCardUrl, SHARE_COPY, SOLO_COPY, spacing, SQUAD_COPY, type Convening, type ThreadMessage } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { AvatarStack } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Composer } from "@/components/Composer";
import { GetTheApp } from "@/components/GetTheApp";
import { PairSpot } from "@/components/PairSpot";
import { MessageSheet } from "@/components/MessageSheet";
import { ThreadMessages } from "@/components/ThreadMessages";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Field, Heading, Notice } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { MY_CHATS_KEY } from "@/lib/myevents";
import { queryClient } from "@/lib/query";
import { markGroupSeen, myPersonId, reportFromMessage, sendGroupMessage } from "@/lib/room";
import { faceSource, signedPhotoUrls } from "@/lib/signed-photos";
import { supabase } from "@/lib/supabase";
import { useThread } from "@/lib/thread";
import { Tap } from "@/components/Tap";

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";
// The card's timer: state, the plan and "I'm here" — and faces re-signed before their URLs lapse.
const SHELL_MS = 30_000;
// "I've looked", at most this often while messages arrive and the thread is in view.
const SEEN_MS = 60_000;

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
  solo: boolean;
  // A squad's name and where its check stands (M3.7); null for a 1-on-1 plan or an old group.
  squad: { name: string; nameStatus: "pending" | "approved" | "rejected"; womenOnly: boolean } | null;
  gathering: { id: string; name: string; slug: string; startsAt: string; endsAt: string | null };
  convening: Convening;
  roomId: string | null;
  meId: string;
  members: { personId: string; firstName: string; photoUrl: string | null; photoPath: string | null; arrivedAt: string | null; arrivalNote: string | null }[];
  closesAt: string | null;
  spot: string | null;
  meetAt: string | null;
  proposals: { id: string; spot: string; meetAt: string; votes: number; mine: boolean }[];
}

// The card: everything on this screen except the thread.
async function loadGroupShell(id: string): Promise<GroupView | null> {
  const db = supabase();
  const meId = await myPersonId();
  if (!meId) return null;
  const { data: c, error } = await db.from("crews").select("id, kind, state, gathering_id, room_id, spot_id, meet_at, name, name_status, women_only, legacy").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!c) return null;
  const [g, conv, mem, props, votes, closes, spot] = await Promise.all([
    db.from("gatherings").select("id, name, slug, starts_at, ends_at").eq("id", c.gathering_id).maybeSingle(),
    db.rpc("convening_of", { p_gathering: c.gathering_id }),
    db.from("crew_members").select("person_id, arrived_at, arrival_note, left_at").eq("crew_id", id),
    db.from("crew_proposals").select("id, spot_id, meet_at, meeting_spots(name)").eq("crew_id", id),
    db.from("crew_proposal_votes").select("proposal_id, person_id"),
    db.rpc("group_closes_at", { p_crew: id }),
    c.spot_id ? db.from("meeting_spots").select("name").eq("id", c.spot_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!g.data) return null;
  const active = (mem.data ?? []).filter((m) => !m.left_at);
  const ids = active.map((m) => m.person_id);
  const { data: people } = await db.from("people").select("id, first_name, photo_path").in("id", ids);
  const urlFor = await signedPhotoUrls((people ?? []).map((p) => p.photo_path));
  const myProps = new Set((props.data ?? []).map((p) => p.id));
  const v = (votes.data ?? []).filter((x) => myProps.has(x.proposal_id));
  return {
    id,
    state: c.state as GroupView["state"],
    solo: c.kind === "solo",
    squad: c.kind === "crew" && !c.legacy && c.name ? { name: c.name, nameStatus: (c.name_status ?? "approved") as "pending" | "approved" | "rejected", womenOnly: c.women_only } : null,
    gathering: { id: g.data.id, name: g.data.name, slug: g.data.slug ?? g.data.id, startsAt: g.data.starts_at, endsAt: g.data.ends_at },
    convening: (conv.data as Convening) ?? "a_spot_first",
    roomId: c.room_id,
    meId,
    members: active.map((m) => {
      const p = (people ?? []).find((x) => x.id === m.person_id);
      return {
        personId: m.person_id,
        firstName: p?.first_name ?? "Someone",
        photoUrl: p?.photo_path ? urlFor.get(p.photo_path) ?? null : null,
        photoPath: p?.photo_path ?? null,
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
      mine: v.some((x) => x.proposal_id === p.id && x.person_id === meId),
    })),
  };
}

export default function Group() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [shared, setShared] = useState<"shared" | "copied" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<ThreadMessage | null>(null);
  const [focused, setFocused] = useState(false);

  const shell = useQuery({
    queryKey: ["group", id],
    queryFn: () => loadGroupShell(id),
    enabled: focused,
    refetchInterval: focused ? SHELL_MS : false,
    refetchOnWindowFocus: false,
  });
  const view = shell.data;
  const { refetch: refetchShell } = shell;
  const refresh = useCallback(() => void refetchShell(), [refetchShell]);
  // A message from someone the card has not met (they joined since it was read): read it once for them.
  const asked = useRef(new Set<string>());
  // Seen (A19's unread): when the thread comes into view, at most once a minute while
  // messages arrive, and when you leave it — then My Events and its tab dot read afresh.
  const lastSeen = useRef(0);
  const seen = useCallback(() => {
    lastSeen.current = Date.now();
    return markGroupSeen(id).catch(() => undefined);
  }, [id]);
  const thread = useThread("group", id, {
    meId: view?.meId,
    focused,
    onIncoming: (m) => {
      if (focused && Date.now() - lastSeen.current >= SEEN_MS) void seen();
      if (view && !view.members.some((p) => p.personId === m.authorId) && !asked.current.has(m.authorId)) {
        asked.current.add(m.authorId);
        refresh();
      }
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

  const shellTrouble = shell.error ? failed("open your group", shell.error) : null;
  const threadTrouble = thread.error ? failed("open your group", thread.error) : null;

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
        <Heading>{GROUP_COPY.heading}</Heading>
        {shellTrouble ? <Trouble what={shellTrouble} onRetry={refresh} /> : <Body muted>This plan isn't yours to see, or it's off.</Body>}
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
  // The box is cleared and the message is on screen at once; the insert confirms it.
  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    try {
      await thread.post(body, () => sendGroupMessage(view.id, view.meId, body));
    } catch (err) {
      setTrouble(failed("send that", err));
    }
  };
  // A failed message, back in the box: the person sends it again, or doesn't (S29).
  const takeBack = (localId: string) => {
    const words = thread.takeBack(localId);
    if (words) setDraft((d) => (d.trim() ? `${words}\n${d}` : words));
  };
  const open = view.state !== "dissolved";
  // Q11: writable until 24 h after the night, read-only after (crew_messages_post_members).
  const closed = Date.now() >= Date.parse(effectiveEnd(view.gathering.startsAt, view.gathering.endsAt)) + 24 * 3_600_000;

  return (
    <AppScreen
      footer={
        open && closed ? (
          <Notice>{GROUP_COPY.readOnly}</Notice>
        ) : open ? (
          <Composer
            value={draft}
            onChangeText={setDraft}
            onSend={() => void send()}
            placeholder={view.solo ? SOLO_COPY.threadPlaceholder(names[0] ?? "them") : GROUP_COPY.threadPlaceholder}
            ready={!!thread.messages}
          />
        ) : undefined
      }
    >
      {/* The squad's header in the room's style (UI pass 1, 071): its faces, its name, how
          many of you and the event. */}
      <View style={styles.header}>
        <AvatarStack
          size={30}
          max={3}
          people={view.members.map((m) => ({ id: m.personId, name: m.personId === view.meId ? "You" : m.firstName, source: m.photoUrl && m.photoPath ? faceSource(m.photoUrl, m.photoPath) : null }))}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.headTitle} numberOfLines={2}>
            {view.solo ? (view.state === "forming" ? SOLO_COPY.pairHeading(names[0] ?? "") : SOLO_COPY.planHeading(names[0] ?? "")) : view.squad ? view.squad.name : GROUP_COPY.heading}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {view.squad ? SQUAD_COPY.headerLine(view.members.length, view.gathering.name) : view.gathering.name}
          </Text>
        </View>
      </View>
      {view.squad?.nameStatus === "pending" ? <Body muted>{SQUAD_COPY.checking}</Body> : null}
      {view.squad?.nameStatus === "rejected" ? <Text accessibilityRole="alert" style={styles.refusal}>{SQUAD_COPY.rejected}</Text> : null}
      {/* Once per person, the first time they are in a group (M3.3). */}
      {me && view.state !== "dissolved" && view.state !== "done" ? <GetTheApp /> : null}


      {trouble ? <Trouble what={trouble} onRetry={refresh} busy={busy} /> : null}

      {view.state === "dissolved" ? (
        <View style={styles.card}>
          <Body>{view.solo ? SOLO_COPY.planOff : GROUP_COPY.closed}</Body>
          {view.roomId ? <Button label={GROUP_COPY.closedNext} onPress={() => router.replace({ pathname: "/room/[id]", params: { id: view.roomId! } })} /> : null}
        </View>
      ) : (
        <View style={styles.card}>
          {/* #17: a pair picks its spot here; it is a plan only once both agree. */}
          {view.solo && view.state === "forming" ? (
            <PairSpot crewId={view.id} gatheringId={view.gathering.id} meId={view.meId} partner={names[0] ?? ""} onChanged={refresh} />
          ) : null}
          {view.solo || view.squad ? null : (
            <Body>{GROUP_COPY.on(names)}</Body>
          )}
          {!view.solo && view.state === "forming" && view.convening !== "at_the_gathering" ? (
            <>
              <Text style={styles.section}>{GROUP_COPY.pollHeading}</Text>
              <Body muted>{GROUP_COPY.pollHint}</Body>
              {view.proposals.map((p) => (
                <Tap
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
                </Tap>
              ))}
            </>
          ) : view.meetAt ? (
            <>
              {/* The plan as one line (UI pass 1, 071), never the lead. */}
              <View style={styles.planLine}>
                <Icon name="pin" size={16} color={palette.textMuted} />
                <Text style={styles.meta}>{`${view.spot ?? SQUAD_COPY.atTheGathering} · ${dayClock(view.meetAt)}`}</Text>
              </View>
              <Button
                kind="quiet"
                label={shared === "copied" ? "Link copied" : shared === "failed" ? "Couldn't share. Try again" : SHARE_COPY.button}
                onPress={async () => {
                  // The event and its venue card, never the meeting place (UI pass 1, rule 3).
                  const url = shareCardUrl(SITE, view.gathering.slug, null, null);
                  setShared(await shareCard(SHARE_COPY.message(view.gathering.name, null, null), url).catch(() => "failed" as const));
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
            <Body>{`You're here: "${me.arrivalNote}"`}</Body>
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
            <Body key={m.personId} muted>{`${m.firstName} is here: "${m.arrivalNote}"`}</Body>
          ))}
        </View>
      ) : null}

      {/* A17 — done: said, counted, and its only action points at A16. */}
      {view.state === "done" ? (
        <View style={styles.card}>
          <Text style={styles.section}>{AFTER_COPY.finished}</Text>
          <Body muted>{AFTER_COPY.finishedCounts(view.members.length, view.members.filter((m) => m.arrivedAt).length)}</Body>
          <Body muted>{AFTER_COPY.finishedLine}</Body>
          <Button label={AFTER_COPY.howDidItGo} onPress={() => router.push({ pathname: "/after/[slug]", params: { slug: view.gathering.slug } })} />
        </View>
      ) : null}

      {open ? (
        <>
          <View>
            {view.solo ? (
              <>
                <Button
                  kind="quiet"
                  label={SOLO_COPY.callOff}
                  onPress={() => void act("call off the 1-on-1", () => supabase().rpc("leave_group", { p_crew: view.id })).then(() => router.replace({ pathname: "/crowd/[slug]", params: { slug: view.gathering.slug } }))}
                />
                <Body muted>{SOLO_COPY.callOffNote}</Body>
              </>
            ) : (
              <Button
                kind="quiet"
                label={view.squad ? SQUAD_COPY.leave : GROUP_COPY.leave}
                onPress={() =>
                  void act(view.squad ? "leave the squad" : "leave the group", () => supabase().rpc("leave_group", { p_crew: view.id })).then(() =>
                    view.squad || !view.roomId
                      ? router.replace({ pathname: "/crowd/[slug]", params: { slug: view.gathering.slug } })
                      : router.replace({ pathname: "/room/[id]", params: { id: view.roomId } }),
                  )
                }
              />
            )}
          </View>

          {/* The group's own thread, last, so its newest message sits over the box. */}
          {threadTrouble ? <Trouble what={threadTrouble} onRetry={thread.retry} /> : null}
          {thread.messages ? (
            <ThreadMessages
              messages={thread.messages}
              meId={view.meId}
              nameOf={(a) => view.members.find((x) => x.personId === a)?.firstName ?? "Someone"}
              faceOf={(a) => {
                const x = view.members.find((m) => m.personId === a);
                return x?.photoUrl && x.photoPath ? faceSource(x.photoUrl, x.photoPath) : null;
              }}
              hasOlder={thread.hasOlder}
              olderBusy={thread.olderBusy}
              onOlder={() => void thread.loadOlder().catch((err) => setTrouble(failed("load earlier messages", err)))}
              onTakeBack={takeBack}
              onLongPress={(m) => (m.authorId === view.meId ? undefined : setHeld(m))}
            />
          ) : !threadTrouble ? (
            <ActivityIndicator style={{ marginTop: spacing.lg }} color={palette.textMuted} />
          ) : null}

          {/* Long-press someone else's message: report THEM, never the message (two taps, H9).
              A group's thread has no delete, so your own message offers nothing. */}
          {held ? (
            <MessageSheet
              held={held}
              mine={held.authorId === view.meId}
              authorName={view.members.find((x) => x.personId === held.authorId)?.firstName ?? "them"}
              onReport={async (reason) => {
                await reportFromMessage(view.meId, held, { crewId: view.id }, reason).catch((err) => setTrouble(failed("report that", err)));
                setHeld(null);
                // A safety reason hides them at once (and calls a 1-on-1 plan with them off): look now.
                thread.recheck();
                refresh();
              }}
              onCancel={() => setHeld(null)}
            />
          ) : null}
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, paddingBottom: spacing.sm, marginBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border },
  headTitle: { fontFamily: fonts.headline, fontSize: 18, color: palette.text },
  planLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  faces: { flexDirection: "row", gap: 6, marginVertical: spacing.md },
  face: { width: 44, height: 44, borderRadius: 22 },
  faceEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  card: { padding: spacing.md, borderWidth: 1, borderColor: palette.accent, borderRadius: radius.md, backgroundColor: palette.surface, gap: spacing.sm, marginBottom: spacing.md },
  section: { fontFamily: fonts.headline, fontSize: 15, color: palette.text, marginTop: spacing.sm },
  pick: { padding: spacing.sm, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  pickOn: { borderColor: palette.accent, backgroundColor: palette.background },
  name: { fontFamily: fonts.headline, fontSize: 15, color: palette.text },
  meta: { fontSize: 12, color: palette.textMuted },
  refusal: { fontSize: 14, color: "#E06B6B" },
});
