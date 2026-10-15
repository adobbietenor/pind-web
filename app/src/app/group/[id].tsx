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
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { AFTER_COPY, colors as palette, fonts, GROUP_COPY, radius, shareCardUrl, SHARE_COPY, SOLO_COPY, spacing, SQUAD_COPY, type Convening } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { GetTheApp } from "@/components/GetTheApp";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Field, Heading, Notice } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { readProfile } from "@/lib/profile";
import { sendGroupMessage } from "@/lib/room";
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
  solo: boolean;
  // A squad's name and where its check stands (M3.7); null for a 1-on-1 plan or an old group.
  squad: { name: string; nameStatus: "pending" | "approved" | "rejected"; womenOnly: boolean } | null;
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
  const { data: c, error } = await db.from("crews").select("id, kind, state, gathering_id, room_id, spot_id, meet_at, name, name_status, women_only, legacy").eq("id", id).maybeSingle();
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
    solo: c.kind === "solo",
    squad: c.kind === "crew" && !c.legacy && c.name ? { name: c.name, nameStatus: (c.name_status ?? "approved") as "pending" | "approved" | "rejected", womenOnly: c.women_only } : null,
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
        {trouble ? <Trouble what={trouble} onRetry={refresh} /> : <Body muted>This plan isn't yours to see — or it's off.</Body>}
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

  return (
    <AppScreen>
      <Heading>{view.solo ? SOLO_COPY.planHeading(names[0] ?? "") : view.squad ? view.squad.name : GROUP_COPY.heading}</Heading>
      <Body muted>{view.squad ? `${SQUAD_COPY.heading} · ${view.gathering.name}` : view.gathering.name}</Body>
      {view.squad?.nameStatus === "pending" ? <Body muted>{SQUAD_COPY.checking}</Body> : null}
      {view.squad?.nameStatus === "rejected" ? <Text accessibilityRole="alert" style={styles.refusal}>{SQUAD_COPY.rejected}</Text> : null}
      {/* Once per person, the first time they are in a group (M3.3). */}
      {me && view.state !== "dissolved" && view.state !== "done" ? <GetTheApp /> : null}

      <View style={styles.faces}>
        {view.members.map((m) =>
          m.photoUrl ? <Image key={m.personId} source={{ uri: m.photoUrl }} style={styles.face} /> : <View key={m.personId} style={[styles.face, styles.faceEmpty]} />,
        )}
      </View>

      {trouble ? <Trouble what={trouble} onRetry={refresh} busy={busy} /> : null}

      {view.state === "dissolved" ? (
        <View style={styles.card}>
          <Body>{view.solo ? SOLO_COPY.planOff : GROUP_COPY.closed}</Body>
          {view.roomId ? <Button label={GROUP_COPY.closedNext} onPress={() => router.replace({ pathname: "/room/[id]", params: { id: view.roomId! } })} /> : null}
        </View>
      ) : (
        <View style={styles.card}>
          {view.solo ? null : view.squad ? (
            <Body>{names.length ? `${SQUAD_COPY.members(view.members.length)} You and ${names.join(", ")}.` : SQUAD_COPY.members(1)}</Body>
          ) : (
            <Body>{GROUP_COPY.on(names)}</Body>
          )}
          {!view.solo && view.state === "forming" && view.convening !== "at_the_gathering" ? (
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
            <TextInput value={draft} onChangeText={setDraft} placeholder={view.solo ? SOLO_COPY.threadPlaceholder(names[0] ?? "them") : GROUP_COPY.threadPlaceholder} placeholderTextColor={palette.tabInactive} maxLength={500} multiline style={styles.input} />
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
        </>
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
  refusal: { fontSize: 14, color: "#E06B6B" },
  input: { minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.sm, color: palette.text, backgroundColor: palette.surface, marginBottom: spacing.sm, fontSize: 15 },
});
