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
//
// **Nothing here filters people.** The list is whatever RLS returns to you (H11): a
// blocked pair, a hidden person, a seed person at a real gathering, someone not open —
// none of them come back, so none are drawn. Photos are signed only where
// `can_see_photo` allows. The gathering is read through RLS too, not the public door,
// so a tester reaches the seed gathering and nobody else does.
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import {
  ALL_TAGS,
  colors as palette,
  countLine,
  CROWD_COPY,
  effectiveEnd,
  fonts,
  NEIGHBOURHOODS,
  radius,
  spacing,
  THRESHOLD,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { whoAmI } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const tagName = (slug: string) => ALL_TAGS.find((t) => t.slug === slug)?.name ?? slug;
const hoodName = (slug: string | null) => NEIGHBOURHOODS.find((n) => n.slug === slug)?.name ?? null;

interface Gathering {
  id: string;
  name: string;
  startsAt: string;
  effectiveEnd: string;
  venue: string;
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
  gathering: Gathering;
  going: number;
  open: number;
  mix: string | null;
  mine: { pinId: string; open: boolean } | null;
  mayMeet: boolean;
  faces: Face[];
}

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
    .select("id, name, starts_at, ends_at, venues(name)")
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

  return { gathering, going: c?.pinned ?? 0, open: c?.open_to_meeting ?? 0, mix, mine, mayMeet, faces };
}

export default function CrowdPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [view, setView] = useState<View9 | null | undefined>(undefined);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);

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
  const count = countLine(view.going, view.open, THRESHOLD);
  const ended = Date.now() >= Date.parse(g.effectiveEnd);

  return (
    <AppScreen>
      <Heading>{g.name}</Heading>
      <Body muted>{`${when(g.startsAt)} · ${g.venue}`}</Body>

      <View style={styles.counts}>
        <Text style={styles.countLine}>{count.line}</Text>
        {count.crews ? <Body muted>{count.crews}</Body> : null}
        {view.mix ? <Body muted>{view.mix}</Body> : null}
      </View>

      {trouble ? <Trouble what={trouble} onRetry={refresh} busy={busy} /> : null}

      {!view.mine ? (
        // A8 — not pinned here.
        !ended ? <Button label={CROWD_COPY.pinIn} onPress={() => router.push(`/pin/${slug}`)} /> : null
      ) : !view.mine.open ? (
        // A9's empty state — one step away, and the step is the biggest thing here.
        <View style={styles.oneStep}>
          <Text style={styles.oneStepHeading}>{CROWD_COPY.notOpenHeading}</Text>
          <Body>{CROWD_COPY.notOpenLine}</Body>
          <Body muted>{CROWD_COPY.notOpenOthers(view.open)}</Body>
          {!ended ? (
            <View style={{ marginTop: spacing.md }}>
              <Button label={CROWD_COPY.openToMeeting} busy={busy} onPress={() => void setOpen(true)} />
              {!view.mayMeet ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Body muted>{CROWD_COPY.openToMeetingHint}</Body>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : (
        // A9 — open: the people the database lets this person see.
        <View>
          <Text style={styles.sectionName}>{CROWD_COPY.listHeading}</Text>
          {view.faces.length === 0 ? (
            <Body muted>{CROWD_COPY.listEmpty}</Body>
          ) : (
            view.faces.map((f) => (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                onPress={() => router.push(`/person/${f.id}`)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                {f.photoUrl ? (
                  <Image source={{ uri: f.photoUrl }} style={styles.face} />
                ) : (
                  <View style={[styles.face, styles.faceEmpty]}>
                    <Text style={styles.faceLetter}>{f.firstName.slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {f.firstName}
                    {f.party > 1 ? <Text style={styles.plus}>{`  +${f.party - 1} friend${f.party > 2 ? "s" : ""}`}</Text> : null}
                  </Text>
                  {hoodName(f.neighbourhood) ? <Text style={styles.hood}>{hoodName(f.neighbourhood)}</Text> : null}
                  {f.tags.length ? <Text style={styles.tags}>{f.tags.map(tagName).join(" · ")}</Text> : null}
                </View>
              </Pressable>
            ))
          )}
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
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  counts: { marginTop: spacing.md, marginBottom: spacing.lg, gap: 2 },
  countLine: { fontFamily: fonts.headline, fontSize: 20, color: palette.text },
  oneStep: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    gap: spacing.sm,
  },
  oneStepHeading: { fontFamily: fonts.headline, fontSize: 22, color: palette.text },
  sectionName: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginBottom: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  face: { width: 52, height: 52, borderRadius: 26 },
  faceEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  faceLetter: { fontFamily: fonts.headline, fontSize: 20, color: palette.textMuted },
  name: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  plus: { fontFamily: undefined, fontSize: 14, color: palette.textMuted },
  hood: { fontSize: 14, color: palette.textMuted, marginTop: 1 },
  tags: { fontSize: 13, color: palette.textTint, marginTop: 3 },
});
