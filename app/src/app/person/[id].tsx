// A22 — someone else's profile (M3.2, built properly; the shell was M3.1).
//
// **It answers "nothing to read"** (Alex, M3.1) without a bio, a handle leak or a grid:
//   * **the shared context** — "You're both going to Leafs vs Bruins": the gatherings
//     where the database lets you see each other, which is exactly the pins of theirs
//     it returns to you (V1, scoped to the gathering). Crews and connections join this
//     in M3.3;
//   * **all their tags, grouped** as the vocabulary groups them — not only the three on
//     the list. V19: readable exactly when you can see the person at all;
//   * **how many gatherings they have been to — a number, never which ones** (Alex):
//     `people.gatherings_count`, readable exactly as their first name is (P119–P122).
//
// **Visible only reciprocally.** Nothing here filters: the screen asks the database
// for the person and renders what comes back. If the policies say no, there is no row
// — and the screen says so plainly rather than inventing a "private profile" state,
// because a page that acknowledges someone exists has already answered the question
// (H3, V1).
//
// **No like, no follow, and no message to a stranger.** "Message" shows only for a
// connection (build 23, Alex 16 Nov 2026): someone you said yes to for a 1-on-1, or kept in
// touch with. It opens your one chat — mutual both ways, never a cold DM (H2). Remove the
// connection, block or report from here, and it ends, silently, for both (H9).
//
// **The Instagram handle appears only when V17 allows it** — a shared crew, a 1-on-1
// plan, or a connection. Never from the open list. And again, that is not decided
// here: `person_handles` simply returns nothing to someone it is not for.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { ALL_TAGS, colors as palette, fonts, NEIGHBOURHOODS, ONE_ON_ONE_COPY, oneOnOneLine, radius, REPORT_REASONS, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { Trouble } from "@/components/Trouble";
import { connectionWith, removeConnection } from "@/lib/connections";
import { MoreButton, ReportBlockSheet } from "@/components/ReportBlock";
import { failed, type Described } from "@/lib/errors";
import { myPersonId } from "@/lib/room";
import { supabase } from "@/lib/supabase";
import { Tap } from "@/components/Tap";

const tagName = (slug: string) => ALL_TAGS.find((t) => t.slug === slug)?.name ?? slug;
const groupOf = (slug: string) => ALL_TAGS.find((t) => t.slug === slug)?.group ?? "";
// The groups in the vocabulary's own order.
const TAG_GROUPS = [...new Set(ALL_TAGS.map((t) => t.group))];
const hoodName = (slug: string | null) => NEIGHBOURHOODS.find((n) => n.slug === slug)?.name ?? null;

interface Them {
  shared: { slug: string; name: string; startsAt: string }[];
  gatherings: number;
  firstName: string;
  neighbourhood: string | null;
  photoUrl: string | null;
  instagram: string | null;
  tags: string[];
  // Our one chat, when we are connected (connection_with: null for anyone else).
  chatId: string | null;
  meId: string | null;
}

export default function Person() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [them, setThem] = useState<Them | null | undefined>(undefined);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const db = supabase();
      const { data: person } = await db
        .from("people")
        .select("first_name, neighbourhood, photo_path, gatherings_count")
        .eq("id", id)
        .maybeSingle();
      if (!live) return;
      if (!person) return setThem(null);

      const [handle, tags, theirPins, chatId, meId] = await Promise.all([
        db.from("person_handles").select("instagram").eq("person_id", id).maybeSingle(),
        db.from("person_tags").select("tag").eq("person_id", id),
        // The shared context: their pins the database shows you are exactly the
        // gatherings where you can see each other. Nothing is filtered here.
        db.from("pins").select("gatherings(slug, name, starts_at)").eq("person_id", id),
        connectionWith(id).catch(() => null),
        myPersonId(),
      ]);
      // **The database decides, alone** (H11). Storage issues a signed URL only when
      // `can_see_photo` allows it — a rejected or invisible photo simply has no URL.
      // This used to also check `photo_status === "approved"`, a second copy of the
      // rule that went stale the day nothing waited on the check (Alex, M3.1).
      let url: string | null = null;
      if (person.photo_path) {
        const signed = await db.storage.from("photos").createSignedUrl(person.photo_path, 300);
        url = signed.data?.signedUrl ?? null;
      }
      if (!live) return;
      const shared = (theirPins.data ?? [])
        .map((p) => (p as unknown as { gatherings: { slug: string; name: string; starts_at: string } | null }).gatherings)
        .filter((g): g is { slug: string; name: string; starts_at: string } => !!g)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((g) => ({ slug: g.slug, name: g.name, startsAt: g.starts_at }));
      setThem({
        shared,
        gatherings: person.gatherings_count ?? 0,
        firstName: person.first_name,
        neighbourhood: person.neighbourhood,
        photoUrl: url,
        instagram: handle.data?.instagram ?? null,
        tags: (tags.data ?? []).map((t) => t.tag),
        chatId,
        meId,
      });
    })();
    return () => {
      live = false;
    };
  }, [id, reload]);

  // Remove, block or report: each ends our connection and chat for both, and tells nobody.
  const act = useCallback(
    async (what: string, run: () => Promise<void>, after: string | null) => {
      setBusy(true);
      setTrouble(null);
      try {
        await run();
        setSheet(false);
        setDone(after);
        setReload((n) => n + 1);
      } catch (err) {
        setTrouble(failed(what, err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (them === undefined) {
    return (
      <AppScreen edges={["top"]} scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  if (them === null) {
    return (
      <AppScreen edges={["top"]}>
        <Heading>Not here</Heading>
          <Body muted>
            People are visible only to each other, and only once you have both pinned in and said you would like to meet at the
            same gathering.
          </Body>
        </AppScreen>
    );
  }

  return (
    <AppScreen edges={["top"]}>
        <View style={styles.head}>
          {them.photoUrl ? (
            <Image source={{ uri: them.photoUrl }} style={styles.face} />
          ) : (
            <View style={[styles.face, styles.faceEmpty]}>
              <Text style={styles.faceLetter}>{them.firstName.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{them.firstName}</Text>
            {hoodName(them.neighbourhood) ? <Text style={styles.hood}>{hoodName(them.neighbourhood)}</Text> : null}
            {/* A number, never which gatherings (Alex, M3.2). */}
            <Text style={styles.hood}>
              {them.gatherings === 0 ? "New to Pin'd" : `${them.gatherings} gathering${them.gatherings === 1 ? "" : "s"} on Pin'd`}
            </Text>
          </View>
          {/* A24: report and block, two taps (H9). A24_EXISTS: S24's exception is gone. */}
          {A24_EXISTS && them.meId && them.meId !== id ? <MoreButton onPress={() => setSheet(true)} /> : null}
        </View>

        {them.shared.length ? (
          <View style={styles.context}>
            <Text style={styles.contextLine}>
              {`You're both going to ${them.shared.map((g) => g.name).join(" and ")}`}
            </Text>
          </View>
        ) : null}

        {/* A profile is outside any one gathering, so 1-on-1 is asked from the event's page
            (UI pass 1, round 2: never a missing button with no reason). The next event you
            share is one tap away. */}
        {(() => {
          if (them.chatId) {
            return (
              <View style={styles.oneOnOne}>
                <Button label={ONE_ON_ONE_COPY.message} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: them.chatId! } })} />
              </View>
            );
          }
          const next = them.shared.find((g) => Date.parse(g.startsAt) > Date.now());
          return (
            <View style={styles.oneOnOne}>
              <Text style={styles.oneOnOneLine}>{oneOnOneLine("elsewhere", them.firstName)}</Text>
              {next ? (
                <Tap accessibilityRole="link" onPress={() => router.push({ pathname: "/crowd/[slug]", params: { slug: next.slug } })} style={styles.oneOnOneLink}>
                  <Text style={styles.oneOnOneLinkLabel}>{ONE_ON_ONE_COPY.openEvent(next.name)}</Text>
                </Tap>
              ) : null}
            </View>
          );
        })()}

        {/* All their tags, in the vocabulary's own groups (V19). */}
        {TAG_GROUPS.map((group) => {
          const mine = them.tags.filter((t) => groupOf(t) === group);
          return mine.length ? (
            <View key={group} style={{ marginBottom: spacing.sm }}>
              <Text style={styles.sectionName}>{group}</Text>
              <View style={styles.chips}>
                {mine.map((t) => (
                  <View key={t} style={styles.chip}>
                    <Text style={styles.chipLabel}>{tagName(t)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null;
        })}

        {them.instagram ? (
          <View style={styles.card}>
            <Text style={styles.sectionName}>Instagram</Text>
            <Body>@{them.instagram}</Body>
          </View>
        ) : null}

        {/* H9 on the profile (build 23): remove the connection, report, block. Each ends our
            chat for both and tells nobody. */}
        {done ? <Notice>{done}</Notice> : null}
        {trouble ? <Trouble what={trouble} /> : null}
        {them.meId && them.meId !== id && them.chatId ? (
          <View style={styles.safety}>
            <Button kind="quiet" label={ONE_ON_ONE_COPY.removeConnection} busy={busy} onPress={() => void act("remove the connection", () => removeConnection(id), null)} />
            <Body muted>{ONE_ON_ONE_COPY.removeNote}</Body>
          </View>
        ) : null}
        <ReportBlockSheet
          target={sheet ? { kind: "person", id, firstName: them.firstName } : null}
          onClose={() => setSheet(false)}
          // Blocked, they are gone from you: back to where you came from, not a "Not here".
          onDone={(what) => (what === "blocked" ? (router.canGoBack() ? router.back() : router.replace("/connections")) : setReload((n) => n + 1))}
        />
      </AppScreen>
  );
}

// A24 (report and block) shipped 16 Nov 2026: the ⋯ opens its sheet (components/ReportBlock).
const A24_EXISTS = true;

const styles = StyleSheet.create({
  oneOnOne: { marginBottom: spacing.md, gap: spacing.xs },
  safety: { marginTop: spacing.lg, gap: spacing.sm },
  oneOnOneLine: { fontSize: 15, color: palette.textMuted },
  oneOnOneLink: { minHeight: 44, justifyContent: "center" },
  oneOnOneLinkLabel: { fontFamily: fonts.headline, fontSize: 15, color: palette.accentText },
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: spacing.lg },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  face: { width: 86, height: 86, borderRadius: 43 },
  faceEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  faceLetter: { fontFamily: fonts.headline, fontSize: 32, color: palette.textMuted },
  name: { fontFamily: fonts.headline, fontSize: 24, color: palette.text },
  hood: { fontSize: 15, color: palette.textMuted, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13 },
  chipLabel: { fontSize: 14, color: palette.text },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  sectionName: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginBottom: spacing.xs },
  context: { marginBottom: spacing.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderLeftWidth: 3, borderLeftColor: palette.accent },
  contextLine: { fontSize: 16, color: palette.text },
  more: { alignSelf: "flex-start", paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  moreLabel: { fontSize: 22, color: palette.textMuted },
});
