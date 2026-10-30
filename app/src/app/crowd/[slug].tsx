// A8 / A9 — the crowd page in the app (M3.2). One route, three states, by what you
// have done at THIS gathering (spec A8–A10; decisions, "After the pin"):
//
//   not pinned        A8: the facts, the counts, one button — "Pin in".
//   pinned, not open  A9's empty state: counts and no faces, and "I'd like to meet people
//                     here" as the most prominent thing on the page — one step away,
//                     not a locked door (Alex; a named M3.2 acceptance item). It goes to
//                     A27 the first time, and simply opens the pin once A27 is done.
//   pinned and open   A9: the people the database lets you see, then the crews line
//                     while it is worth saying. The reciprocal list works at TWO —
//                     `can_see_at` never counts (P09–P13); five gates crews only.
//                     Below the room, squads (A15, M3.7: SquadSection) — your squad's
//                     card instead when you are in one — then 1-on-1 (A28/A29, M3.4).
//
// **Nothing here filters people.** The list is whatever RLS returns to you (H11): a
// blocked pair, a hidden person, a seed person at a real gathering, someone not open —
// none of them come back, so none are drawn. Photos are signed only where
// `can_see_photo` allows. The gathering is read through RLS too, not the public door,
// so a tester reaches the seed gathering and nobody else does.
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, StyleSheet, Text, View } from "react-native";
import {
  ALL_TAGS,
  CITY_ATTRIBUTION,
  colors as palette,
  clockLocal,
  countNext,
  CROWD_COPY,
  ENDED_COPY,
  liveCity,
  ROOM_COPY,
  effectiveEnd,
  fonts,
  NEIGHBOURHOODS,
  QUICKPIN_COPY,
  radius,
  spacing,
  WOMEN_ONLY_COPY,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Avatar, AvatarStack } from "@/components/Avatar";
import { Counters } from "@/components/Counters";
import { Icon } from "@/components/Icon";
import { PersonSheet, type SheetPerson } from "@/components/PersonSheet";
import { HouseRules } from "@/components/HouseRules";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { PushAsk } from "@/components/PushAsk";
import { SoloSection } from "@/components/SoloSection";
import { SquadSection } from "@/components/SquadSection";
import { EndedEvent } from "@/components/EndedEvent";
import { myRooms, type RoomSummary } from "@/lib/room";
import { joinGeneralRoom, waitingForWomenOnlyRoom } from "@/lib/after";
import { whoAmI } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { Tap } from "@/components/Tap";

// W2's facts, as W2's own functions decide them (the Worker's /g/<slug>/facts.json):
// the map, its numbered markers, the spots, the cost line. One copy of each rule.
const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";
const WORKER = Platform.OS === "web" ? "" : SITE;
interface Facts {
  when: string;
  venue: string;
  address: string | null;
  blurb: string | null;
  why: string | null;
  cost: string | null;
  map: { src: string; width: number; height: number; openInMaps: string | null; markers: { n: number; left: number; top: number }[] } | null;
  spots: { n: number | null; name: string; description: string | null; meet: string; walk: number | null; offMap: boolean; directions: string | null }[];
}
async function factsFor(slug: string): Promise<Facts | null> {
  // A seed gathering has no public door, so it has no facts here: a tester sees the
  // rows RLS gives them, and the page says less. Real gatherings get W2's anatomy.
  const res = await fetch(`${WORKER}/g/${slug}/facts.json`).catch(() => null);
  return res?.ok ? ((await res.json()) as Facts) : null;
}

const tagName = (slug: string) => ALL_TAGS.find((t) => t.slug === slug)?.name ?? slug;
const hoodName = (slug: string | null) => NEIGHBOURHOODS.find((n) => n.slug === slug)?.name ?? null;

interface Gathering {
  id: string;
  name: string;
  startsAt: string;
  effectiveEnd: string;
  venue: string;
  // From the City of Toronto's feed (M4.4): its licence line goes at the foot.
  fromCity: boolean;
}
interface Face {
  id: string;
  firstName: string;
  neighbourhood: string | null;
  photoUrl: string | null;
  tags: string[];
  party: number;
}
interface View9 {
  facts: Facts | null;
  gathering: Gathering;
  going: number;
  open: number;
  mix: string | null;
  mine: { pinId: string; open: boolean } | null;
  mayMeet: boolean;
  faces: Face[];
  // The room (M3.3), when open to meeting here.
  rooms: RoomSummary[];
  // "Women-only rooms only", and that room is not open yet (never how many — Q9).
  waitingWomenOnly: boolean;
  lastLines: { who: string; body: string }[];
  email: string | null;
  meId: string | null;
}

// The venue's own clock: the one live city's (Toronto); every gathering today is there.
const TZ = liveCity().timezone;

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

async function load(slug: string): Promise<View9 | null> {
  const db = supabase();
  const { data: g, error } = await db
    .from("gatherings")
    .select("id, name, starts_at, ends_at, source, venues(name)")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!g) return null;
  const gathering: Gathering = {
    id: g.id,
    name: g.name,
    startsAt: g.starts_at,
    effectiveEnd: effectiveEnd(g.starts_at, g.ends_at),
    venue: (g as unknown as { venues: { name: string } | null }).venues?.name ?? "",
    fromCity: g.source === "city",
  };

  const { data: counts } = await db.rpc("gathering_counts", { gathering_ids: [g.id] });
  const c = (counts as { pinned: number; open_to_meeting: number; women: number | null; men: number | null; other: number | null }[] | null)?.[0];
  const mix = c && c.women !== null && c.men !== null ? [`${c.women} women`, `${c.men} men`, ...(c.other ? [`${c.other} other`] : [])].join(" · ") : null;

  let mine: View9["mine"] = null;
  let mayMeet = false;
  let meId: string | null = null;
  const who = await whoAmI();
  if (who.state === "in") {
    const { data: me } = await db.from("people").select("id").eq("auth_user_id", who.userId).maybeSingle();
    meId = me?.id ?? null;
    if (meId) {
      const { data: pin } = await db.from("pins").select("id, open_to_meeting").eq("person_id", meId).eq("gathering_id", g.id).maybeSingle();
      if (pin) mine = { pinId: pin.id, open: pin.open_to_meeting };
      mayMeet = (await db.rpc("i_may_meet")).data === true;
    }
  }

  // The list: whatever RLS returns to this person, and nothing is filtered here.
  let faces: Face[] = [];
  if (mine?.open) {
    const { data: pins, error: pinsError } = await db
      .from("pins")
      .select("party_total, people(id, first_name, neighbourhood, photo_path)")
      .eq("gathering_id", g.id)
      .eq("open_to_meeting", true);
    if (pinsError) throw pinsError;
    const people = (pins ?? [])
      .map((p) => ({ party: p.party_total, person: (p as unknown as { people: { id: string; first_name: string; neighbourhood: string | null; photo_path: string | null } | null }).people }))
      .filter((p): p is { party: number; person: NonNullable<typeof p.person> } => !!p.person && p.person.id !== meId);
    const ids = people.map((p) => p.person.id);
    const { data: tags } = ids.length
      ? await db.from("person_tags").select("person_id, tag").in("person_id", ids).eq("on_list", true)
      : { data: [] as { person_id: string; tag: string }[] };
    const paths = people.map((p) => p.person.photo_path).filter((x): x is string => !!x);
    const signed = paths.length ? (await db.storage.from("photos").createSignedUrls(paths, 300)).data ?? [] : [];
    const urlFor = new Map(signed.filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));
    faces = people.map((p) => ({
      id: p.person.id,
      firstName: p.person.first_name,
      neighbourhood: p.person.neighbourhood,
      photoUrl: p.person.photo_path ? urlFor.get(p.person.photo_path) ?? null : null,
      tags: (tags ?? []).filter((t) => t.person_id === p.person.id).map((t) => t.tag),
      party: p.party,
    }));
  }

  // The room (M3.3) — through RLS. Squads load in their own section.
  let rooms: RoomSummary[] = [];
  let waitingWomenOnly = false;
  let lastLines: View9["lastLines"] = [];
  let email: string | null = null;
  if (mine?.open && meId) {
    rooms = await myRooms(g.id);
    waitingWomenOnly = await waitingForWomenOnlyRoom(g.id);
    // Someone with "women-only rooms only" talks in that room: it leads, as the general
    // room does for everyone else.
    const general = rooms.find((r) => !r.womenOnly) ?? rooms.find((r) => r.womenOnly);
    if (general?.open) {
      const { data: last } = await db.from("room_messages").select("author_id, body, created_at").eq("room_id", general.roomId).order("created_at", { ascending: false }).limit(2);
      lastLines = (last ?? []).reverse().map((m) => ({
        who: m.author_id === meId ? "You" : faces.find((f) => f.id === m.author_id)?.firstName ?? "Someone",
        body: m.body,
      }));
    }
    const { data: session } = await db.auth.getSession();
    email = session.session?.user.email ?? null;
  }

  return { facts: await factsFor(slug), gathering, going: c?.pinned ?? 0, open: c?.open_to_meeting ?? 0, mix, mine, mayMeet, faces, rooms, waitingWomenOnly, lastLines, email, meId };
}

export default function CrowdPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [view, setView] = useState<View9 | null | undefined>(undefined);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetPerson | null>(null);
  const [allFaces, setAllFaces] = useState(false);

  const refresh = useCallback(() => {
    setTrouble(null);
    load(slug)
      .then(setView)
      .catch((err) => {
        setTrouble(failed("load this crowd", err));
        setView((v) => v ?? null);
      });
  }, [slug]);

  // Every visit, not once: the list changes as people say yes.
  useFocusEffect(refresh);

  const setOpen = async (open: boolean) => {
    if (!view?.mine) return;
    // The first time, "I'd like to meet people" is A27 — the database refuses the flag
    // until it is done (the opt-in gate). After that it is one tap.
    if (open && !view.mayMeet) return router.push(`/opt-in/${slug}`);
    setBusy(true);
    setTrouble(null);
    try {
      const { error } = await supabase().from("pins").update({ open_to_meeting: open }).eq("id", view.mine.pinId);
      if (error) throw error;
      refresh();
    } catch (err) {
      setTrouble(failed(open ? "open you to meeting" : "take you off the list", err));
    } finally {
      setBusy(false);
    }
  };

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
        <Heading>Not on Pin'd</Heading>
        {trouble ? <Trouble what={trouble} onRetry={refresh} /> : <Body muted>That crowd is not on Pin'd, or it has finished.</Body>}
      </AppScreen>
    );
  }

  const g = view.gathering;
  const ended = Date.now() >= Date.parse(g.effectiveEnd);
  // Tonight: the venue's own day, or under way. "Last night": it started on the venue's
  // yesterday.
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const tonight = !ended && (Date.parse(g.startsAt) <= Date.now() || day(new Date(g.startsAt)) === day(new Date()));
  const lastNight = day(new Date(g.startsAt)) === day(new Date(Date.now() - 86_400_000));

  return (
    <AppScreen>
      {/* UI pass 1 (088, 089): a tag over the title on the night and after it, and the
          line under it says when in those words. */}
      {ended || tonight ? <Text style={[styles.dayTag, ended && styles.dayTagEnded]}>{ended ? ENDED_COPY.endedTag : ENDED_COPY.tonightTag}</Text> : null}
      <Heading>{g.name}</Heading>
      <Body muted>{`${ended && lastNight ? ENDED_COPY.lastNight : tonight && !ended ? ENDED_COPY.startsAt(clockLocal(g.startsAt, TZ)) : view.facts?.when ?? when(g.startsAt)} · ${g.venue}`}</Body>
      {view.facts?.address ? <Body muted>{view.facts.address}</Body> : null}
      {view.facts?.blurb ? (
        <View style={{ marginTop: spacing.sm }}>
          <Body>{view.facts.blurb}</Body>
          {view.facts.why ? <Body muted>{view.facts.why}</Body> : null}
        </View>
      ) : null}

      <View style={styles.counts}>
        {ended && view.mine ? (
          // After the night, one number: how many went (089). No going/open counters.
          <View style={styles.wentRow}>
            <Icon name="person" size={22} color={palette.accentText} />
            <Text style={styles.went}>{ENDED_COPY.went(view.going)}</Text>
          </View>
        ) : (
        <Counters going={view.going} open={view.open} />
        )}
        {countNext(view.open) ? <Body muted>{countNext(view.open)}</Body> : null}
        {view.mix ? <Body muted>{view.mix}</Body> : null}
      </View>

      {trouble ? <Trouble what={trouble} onRetry={refresh} busy={busy} /> : null}

      {!view.mine ? (
        // A8 — not pinned here.
        !ended ? (
          <>
            <Button label={CROWD_COPY.pinIn} onPress={() => router.push(`/pin/${slug}`)} />
            {view.facts?.cost ? <Text style={styles.cost}>{view.facts.cost}</Text> : null}
          </>
        ) : (
          // Finished: pinning is closed (P37b), and the page says so — a button that
          // silently vanishes reads as a broken page (Alex, 6 Oct, on the phone).
          <Body muted>{QUICKPIN_COPY.closed}</Body>
        )
      ) : ended ? (
        // #18: an ended event says so, with each chat by its phase — never the room's
        // "you're the first here", a share or a squad to start (components/EndedEvent).
        <EndedEvent gatheringId={g.id} slug={slug} />
      ) : !view.mine.open ? (
        // A9's empty state — one step away, and the step is the biggest thing here.
        <View style={styles.oneStep}>
          <Text style={styles.oneStepHeading}>{CROWD_COPY.notOpenHeading}</Text>
          <Body>{CROWD_COPY.notOpenLine}</Body>
          {!ended ? (
            <View style={{ marginTop: spacing.sm }}>
              <Button label={CROWD_COPY.openToMeeting} busy={busy} onPress={() => void setOpen(true)} />
              <View style={{ marginTop: spacing.sm }}>
                <Text style={styles.small}>{CROWD_COPY.openToMeetingHint}</Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        // A9 — open: the room first (M3.3), then the people the database lets you see.
        <View>
          {(() => {
            if (view.waitingWomenOnly) {
              // "Women-only rooms only", and it isn't open yet: waiting, said plainly —
              // what for, and the one-tap way out (Alex). Never how many (Q9).
              return (
                <View style={[styles.oneStep, { marginTop: spacing.md }]}>
                  <Text style={styles.oneStepHeading}>{WOMEN_ONLY_COPY.waitingHeading}</Text>
                  <Body>{WOMEN_ONLY_COPY.waitingLine}</Body>
                  <PushAsk />
                  <Button
                    kind="quiet"
                    label={WOMEN_ONLY_COPY.joinGeneral}
                    busy={busy}
                    onPress={async () => {
                      setBusy(true);
                      try {
                        await joinGeneralRoom(view.gathering.id);
                        refresh();
                      } catch (err) {
                        setTrouble(failed("join the general room", err));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                  <Body muted>{WOMEN_ONLY_COPY.joinGeneralWhat}</Body>
                </View>
              );
            }
            const general = view.rooms.find((r) => !r.womenOnly) ?? view.rooms.find((r) => r.womenOnly);
            const wo = view.rooms.find((r) => r.womenOnly && r !== general);
            if (!general) return null;
            if (!general.open) {
              // 1 — just you: a good place to be, and the promise is notification #2.
              return (
                <View style={[styles.oneStep, { marginTop: spacing.md }]}>
                  <Text style={styles.oneStepHeading}>{ROOM_COPY.firstHeading}</Text>
                  <Body>{ROOM_COPY.firstLine}</Body>
                  <Body muted>{ROOM_COPY.firstWhy}</Body>
                  {Platform.OS === "web" && view.email ? <Body muted>{ROOM_COPY.firstByEmail(view.email)}</Body> : null}
                  <PushAsk />
                  <Button kind="quiet" label={ROOM_COPY.firstShare} onPress={() => void Linking.openURL(`${SITE}/g/${slug}`)} />
                </View>
              );
            }
            // The Pin'd Meeting Room, the main card (UI pass 1, 055): solid purple, its
            // faces and how many are in it, one white button. Squads below are plain boxes.
            return (
              <View style={{ gap: spacing.sm }}>
              <View style={styles.roomCard}>
                <View style={styles.roomKicker}>
                  <Icon name="chat" size={18} color={palette.onAccent} />
                  <Text style={styles.roomKickerLabel}>{general.womenOnly ? WOMEN_ONLY_COPY.room : CROWD_COPY.roomKicker}</Text>
                </View>
                <Text style={styles.roomTitle}>{CROWD_COPY.roomTitle}</Text>
                <View style={styles.roomFaces}>
                  <AvatarStack size={36} people={view.faces.map((f) => ({ id: f.id, name: f.firstName, source: f.photoUrl }))} />
                  <Text style={styles.roomCount}>{CROWD_COPY.roomCount(general.members)}</Text>
                </View>
                <Tap accessibilityRole="button" onPress={() => router.push({ pathname: "/room/[id]", params: { id: general.roomId } })} style={styles.roomButton}>
                  <Text style={styles.roomButtonLabel}>{view.lastLines.length ? ROOM_COPY.openRoom : CROWD_COPY.roomSayHi}</Text>
                </Tap>
              </View>
                {/* No count on it: next to the public mix, one would tell how many nonbinary
                    people opted in (decisions Q9, "never a number"). */}
                {/* The women-only room beside the main one, in the soft pink accent (UI pass 1,
                    105). No count on it (Q9, "never a number"). */}
                {wo ? (
                  <Tap accessibilityRole="button" onPress={() => router.push({ pathname: "/room/[id]", params: { id: wo.roomId } })} style={styles.woCard}>
                    <Icon name="chat" size={20} color="#F7C6DE" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.woTitle}>{WOMEN_ONLY_COPY.room}</Text>
                      <Text style={styles.woLine}>{WOMEN_ONLY_COPY.roomCardLine}</Text>
                    </View>
                    <Text style={styles.rowChevron}>›</Text>
                  </Tap>
                ) : null}
              </View>
            );
          })()}
          {view.meId ? (
            <SquadSection gatheringId={g.id} meId={view.meId} ended={ended} faces={view.faces.map((f) => ({ id: f.id, firstName: f.firstName, photoUrl: f.photoUrl }))} />
          ) : null}
          {view.meId ? (
            <SoloSection
              gatheringId={g.id}
              pinId={view.mine.pinId}
              meId={view.meId}
              ended={ended}
              faces={view.faces.map((f) => ({ id: f.id, firstName: f.firstName, photoUrl: f.photoUrl, tags: f.tags.map(tagName).join(" · ") }))}
            />
          ) : null}
          {/* The open-to-meeting list: people you can tap (UI pass 1, 055), the profile
              sheet rather than leaving the page. Three, then "See all". */}
          <Text style={[styles.listHeading, { marginTop: spacing.lg }]}>{CROWD_COPY.listHeading}</Text>
          {view.faces.length === 0 ? (
            <Body muted>{CROWD_COPY.listEmpty}</Body>
          ) : (
            (allFaces ? view.faces : view.faces.slice(0, 3)).map((f) => (
              <Tap
                key={f.id}
                accessibilityRole="button"
                onPress={() =>
                  setSheet({ id: f.id, firstName: f.firstName, photo: f.photoUrl, area: hoodName(f.neighbourhood), tags: f.tags.map(tagName).filter(Boolean) as string[] })
                }
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <Avatar name={f.firstName} source={f.photoUrl} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {f.firstName}
                    {f.party > 1 ? <Text style={styles.plus}>{`  +${f.party - 1} friend${f.party > 2 ? "s" : ""}`}</Text> : null}
                  </Text>
                  {hoodName(f.neighbourhood) ? <Text style={styles.hood}>{hoodName(f.neighbourhood)}</Text> : null}
                </View>
                <Text style={styles.rowChevron}>›</Text>
              </Tap>
            ))
          )}
          {!allFaces && view.faces.length > 3 ? (
            <Text accessibilityRole="button" onPress={() => setAllFaces(true)} style={styles.seeAll}>
              {CROWD_COPY.seeAll(view.faces.length)}
            </Text>
          ) : null}
          <PersonSheet
            person={sheet}
            onClose={() => setSheet(null)}
            onSayHi={(() => {
              const room = view.rooms.find((r) => !r.womenOnly && r.open) ?? view.rooms.find((r) => r.open);
              return room
                ? () => {
                    setSheet(null);
                    router.push({ pathname: "/room/[id]", params: { id: room.roomId } });
                  }
                : undefined;
            })()}
            onProfile={() => {
              const id = sheet?.id;
              setSheet(null);
              if (id) router.push(`/person/${id}`);
            }}
          />
          {!ended ? (
            <View style={{ marginTop: spacing.lg }}>
              <Button kind="quiet" label={CROWD_COPY.turnOff} busy={busy} onPress={() => void setOpen(false)} />
            </View>
          ) : null}
        </View>
      )}

      {view.mine ? (
        <View style={{ marginTop: spacing.lg }}>
          <Button kind="quiet" label="Change or remove my pin" onPress={() => router.push(`/pin/${slug}`)} />
        </View>
      ) : null}

      {/* W2's anatomy (spec A8): house rules as one closed row (UI pass 1, rule 2), then the
          venue map. No meeting-place lines (rule 3). */}
      <View style={{ marginTop: spacing.md }}>
        <HouseRules />
      </View>

      {view.facts?.map ? (
        <View style={{ marginTop: spacing.xl }}>
          <View style={[styles.mapBox, { aspectRatio: view.facts.map.width / view.facts.map.height }]}>
            <Image
              source={{ uri: view.facts.map.src }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel="Map of the venue. No people are shown."
            />
            <View style={styles.venuePin} />
          </View>
          <Text style={styles.caption}>
            {view.facts.map.openInMaps ? (
              <Text style={styles.link} onPress={() => void Linking.openURL(view.facts!.map!.openInMaps!)}>
                {"Open in Maps"}
              </Text>
            ) : null}
          </Text>
        </View>
      ) : null}

      {view.gathering.fromCity ? (
        <Text style={styles.caption} onPress={() => void Linking.openURL(CITY_ATTRIBUTION.href)}>
          {CITY_ATTRIBUTION.text}
        </Text>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  cost: { marginTop: spacing.sm, textAlign: "center", color: palette.textMuted, fontSize: 14 },
  rules: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  rule: { fontSize: 15, lineHeight: 21, color: palette.text },
  mapBox: { width: "100%", borderRadius: radius.md, overflow: "hidden", backgroundColor: palette.surface },
  venuePin: { position: "absolute", left: "50%", top: "50%", width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: 8, backgroundColor: palette.accent, borderWidth: 3, borderColor: "#fff" },
  marker: { position: "absolute", width: 26, height: 26, marginLeft: -13, marginTop: -13, borderRadius: 13, backgroundColor: palette.accent, borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  markerNum: { color: "#fff", fontSize: 13, fontWeight: "700" },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center" },
  caption: { marginTop: spacing.sm, fontSize: 13, color: palette.textMuted },
  link: { color: palette.accentText, fontSize: 14 },
  spot: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border, gap: 3 },
  spotName: { fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  meta: { fontSize: 13, color: palette.textMuted },
  counts: { marginTop: spacing.md, marginBottom: spacing.lg, gap: 4 },
  small: { fontSize: 13, lineHeight: 18, color: palette.textMuted },
  oneStep: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    gap: spacing.sm,
  },
  oneStepHeading: { fontFamily: fonts.headline, fontSize: 22, color: palette.text },
  roomCard: { marginTop: spacing.md, padding: spacing.lg - 4, borderRadius: 18, backgroundColor: palette.accent, gap: spacing.sm + 4 },
  roomKicker: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  roomKickerLabel: { fontFamily: fonts.headline, fontSize: 14, color: "#E9DDF6" },
  roomTitle: { fontFamily: fonts.headline, fontSize: 26, lineHeight: 31, color: palette.onAccent },
  roomFaces: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4 },
  roomCount: { flex: 1, fontFamily: fonts.headline, fontSize: 16, color: palette.onAccent },
  roomButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: "#FFFFFF" },
  roomButtonLabel: { fontFamily: fonts.headline, fontSize: 18, color: palette.accent },
  listHeading: { fontFamily: fonts.headline, fontSize: 17, color: palette.text, marginBottom: spacing.sm },
  dayTag: { alignSelf: "flex-start", fontFamily: fonts.headline, fontSize: 12, color: "#E9DDF6", backgroundColor: "#3A2A4E", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: "hidden", marginBottom: spacing.xs },
  dayTagEnded: { color: palette.textMuted, backgroundColor: "#24222A" },
  wentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4 },
  went: { fontFamily: fonts.headline, fontSize: 20, color: palette.text },
  woCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, minHeight: 60, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: "#8A3E66", backgroundColor: "#22141C" },
  woTitle: { fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  woLine: { fontSize: 13, color: "#E7B9CF", marginTop: 1 },
  rowChevron: { fontSize: 22, color: palette.textMuted },
  seeAll: { color: palette.accentText, fontSize: 15, textDecorationLine: "underline", marginTop: spacing.sm, paddingVertical: spacing.sm },
  sectionName: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginBottom: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  face: { width: 52, height: 52, borderRadius: 26 },
  faceEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  faceLetter: { fontFamily: fonts.headline, fontSize: 20, color: palette.textMuted },
  name: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  plus: { fontFamily: undefined, fontSize: 14, color: palette.textMuted },
  hood: { fontSize: 14, color: palette.textMuted, marginTop: 1 },
  tags: { fontSize: 13, color: palette.textTint, marginTop: 3 },
});
