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
// **No message button, no like, no follow.** The absence is the design (spec A22).
// There are no DMs in Pin'd; copy that implies you could message first and decide
// later describes a different app (spec §5).
//
// **The Instagram handle appears only when V17 allows it** — a shared crew, a 1-on-1
// plan, or a connection. Never from the open list. And again, that is not decided
// here: `person_handles` simply returns nothing to someone it is not for.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { ALL_TAGS, colors as palette, fonts, NEIGHBOURHOODS, radius, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Body, Heading } from "@/components/ui";
import { supabase } from "@/lib/supabase";

const tagName = (slug: string) => ALL_TAGS.find((t) => t.slug === slug)?.name ?? slug;
const groupOf = (slug: string) => ALL_TAGS.find((t) => t.slug === slug)?.group ?? "";
// The groups in the vocabulary's own order.
const TAG_GROUPS = [...new Set(ALL_TAGS.map((t) => t.group))];
const hoodName = (slug: string | null) => NEIGHBOURHOODS.find((n) => n.slug === slug)?.name ?? null;

interface Them {
  shared: { slug: string; name: string }[];
  gatherings: number;
  firstName: string;
  neighbourhood: string | null;
  photoUrl: string | null;
  instagram: string | null;
  tags: string[];
}

export default function Person() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [them, setThem] = useState<Them | null | undefined>(undefined);

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

      const [handle, tags, theirPins] = await Promise.all([
        db.from("person_handles").select("instagram").eq("person_id", id).maybeSingle(),
        db.from("person_tags").select("tag").eq("person_id", id),
        // The shared context: their pins the database shows you are exactly the
        // gatherings where you can see each other. Nothing is filtered here.
        db.from("pins").select("gatherings(slug, name, starts_at)").eq("person_id", id),
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
        .map((g) => ({ slug: g.slug, name: g.name }));
      setThem({
        shared,
        gatherings: person.gatherings_count ?? 0,
        firstName: person.first_name,
        neighbourhood: person.neighbourhood,
        photoUrl: url,
        instagram: handle.data?.instagram ?? null,
        tags: (tags.data ?? []).map((t) => t.tag),
      });
    })();
    return () => {
      live = false;
    };
  }, [id]);

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
        </View>

        {them.shared.length ? (
          <View style={styles.context}>
            <Text style={styles.contextLine}>
              {`You're both going to ${them.shared.map((g) => g.name).join(" and ")}`}
            </Text>
          </View>
        ) : null}

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

        {/* Report and block are two taps from everywhere (H9). The sheet itself is
            A24, in M3.5; this is the tap that will open it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More"
          onPress={() => router.push(`/person/${id}/report`)}
          style={styles.more}
        >
          <Text style={styles.moreLabel}>⋯</Text>
        </Pressable>
      </AppScreen>
  );
}

const styles = StyleSheet.create({
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
