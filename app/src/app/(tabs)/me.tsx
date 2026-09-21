// A21 — Profile (self), at /me.
//
// Face, first name, neighbourhood, three tags, the counts, and the optional Instagram
// handle. **No followers, no grid, no bio** (spec A21) — the absence is the design,
// the same way A22's missing message button is.
//
// **Gender is on no profile, not even your own** (D1). There is nothing to render and
// nothing to hide: it is asked once at A2 and lives in `people_private`.
//
// **Preview what others see** is a real button, not a reassurance. It shows the two
// things people get wrong about this product: that the photo is only visible once it
// is approved *and* only to someone who has pinned and opted in alongside you, and
// that the handle goes no further than crewmates and connections (V17).
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ALL_TAGS, colors as palette, fonts, NEIGHBOURHOODS, PHOTO_STATE, radius, spacing } from "@pind/shared";
import { Body, Button, Field, Heading, Notice } from "@/components/ui";
import { loadMe, photoUrl, saveInstagram, type Me } from "@/lib/profile";

const tagName = (slug: string) => ALL_TAGS.find((t) => t.slug === slug)?.name ?? slug;
const hoodName = (slug: string | null) => NEIGHBOURHOODS.find((n) => n.slug === slug)?.name ?? null;

export default function Profile() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [url, setUrl] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");

  // Reloads on every visit rather than once: the photo's state changes underneath
  // this screen while a check runs, and a stale "checking…" would be the screen
  // lying about something the person is waiting on.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const loaded = await loadMe().catch(() => null);
        if (!live) return;
        setMe(loaded);
        setHandle(loaded?.instagram ?? "");
        setUrl(await photoUrl(loaded?.photoPath ?? null));
      })();
      return () => {
        live = false;
      };
    }, []),
  );

  if (me === undefined) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </SafeAreaView>
    );
  }

  if (me === null) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <ScrollView contentContainerStyle={styles.body}>
          <Heading>Profile</Heading>
          <View style={styles.card}>
            <Body muted>
              Nothing here yet. Set yourself up and the people you meet will have a face and a first name to go on.
            </Body>
            <View style={{ marginTop: spacing.md }}>
              <Button label="Set up your profile" onPress={() => router.push("/sign-in")} />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const saveHandle = async () => {
    setError("");
    try {
      await saveInstagram(me.id, handle);
      setMe({ ...me, instagram: handle.trim().replace(/^@/, "") || null });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not save.");
    }
  };

  const approved = me.photoStatus === "approved";

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Heading>Profile</Heading>

        {error ? <Notice tone="stop">{error}</Notice> : null}

        <View style={styles.head}>
          {url ? (
            <Image source={{ uri: url }} style={styles.face} />
          ) : (
            <View style={[styles.face, styles.faceEmpty]}>
              <Text style={styles.faceLetter}>{me.firstName.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {me.firstName}
              {me.lastInitial ? ` ${me.lastInitial}.` : ""}
            </Text>
            {hoodName(me.neighbourhood) ? <Text style={styles.hood}>{hoodName(me.neighbourhood)}</Text> : null}
          </View>
        </View>

        {/* The photo's state, in its own words. "We could not tell" and "we refused
            it" are different sentences wherever they appear (Alex, M3.1). */}
        {me.photoPath && !approved ? (
          <Notice tone={me.photoStatus === "rejected" ? "stop" : "quiet"}>{PHOTO_STATE[me.photoStatus]}</Notice>
        ) : null}
        {!me.photoPath ? (
          <Notice>
            You have no photo, so you are on no list yet. Your crew looks for a face at a patio table.
          </Notice>
        ) : null}

        {me.tags.length ? (
          <View style={styles.chips}>
            {me.tags.map((t) => (
              <View key={t} style={styles.chip}>
                <Text style={styles.chipLabel}>{tagName(t)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ marginBottom: spacing.md }}>
            <Body muted>No tags yet — three of them give a crew something to start with.</Body>
          </View>
        )}

        <View style={styles.counts}>
          <View style={styles.count}>
            <Text style={styles.countNumber}>{me.gatherings}</Text>
            <Text style={styles.countLabel}>pinned</Text>
          </View>
          <View style={styles.count}>
            <Text style={styles.countNumber}>{me.crewsMet}</Text>
            <Text style={styles.countLabel}>crews</Text>
          </View>
          {/* The only badge in Pin'd, and it is earned by a mutual "we met" (A16,
              M3.3). Absent rather than greyed out: a badge nobody can have yet is
              an advert for a feature, not a profile. */}
          {me.showedUp ? (
            <View style={styles.count}>
              <Text style={styles.countNumber}>✓</Text>
              <Text style={styles.countLabel}>showed up</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionName}>Instagram</Text>
        {editing ? (
          <>
            <Field
              label="Your handle"
              value={handle}
              onChangeText={setHandle}
              autoCapitalize="none"
              placeholder="yourname"
              hint="Optional, and never instead of the photo. Leave it empty to remove it."
            />
            <Button label="Save" onPress={saveHandle} />
            <View style={{ marginTop: spacing.sm }}>
              <Button kind="quiet" label="Cancel" onPress={() => { setHandle(me.instagram ?? ""); setEditing(false); }} />
            </View>
          </>
        ) : (
          <View style={styles.card}>
            <Body muted>
              {me.instagram ? `@${me.instagram}` : "Not added. It is optional, and never instead of the photo."}
            </Body>
            <View style={{ marginTop: spacing.sm }}>
              <Body muted>Only your crewmates, a 1-on-1 partner and your connections can see it. Never the open list.</Body>
            </View>
            <View style={{ marginTop: spacing.md }}>
              <Button kind="quiet" label={me.instagram ? "Edit or remove" : "Add a handle"} onPress={() => setEditing(true)} />
            </View>
          </View>
        )}

        <View style={{ marginTop: spacing.lg }}>
          <Button kind="quiet" label={preview ? "Hide the preview" : "Preview what others see"} onPress={() => setPreview(!preview)} />
        </View>

        {preview ? (
          <View style={styles.preview}>
            <Text style={styles.sectionName}>What someone on the list sees</Text>
            <View style={styles.head}>
              {approved && url ? (
                <Image source={{ uri: url }} style={styles.face} />
              ) : (
                <View style={[styles.face, styles.faceEmpty]}>
                  <Text style={styles.faceLetter}>{me.firstName.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{me.firstName}</Text>
                {hoodName(me.neighbourhood) ? <Text style={styles.hood}>{hoodName(me.neighbourhood)}</Text> : null}
              </View>
            </View>
            {me.tags.length ? (
              <View style={styles.chips}>
                {me.tags.map((t) => (
                  <View key={t} style={styles.chip}>
                    <Text style={styles.chipLabel}>{tagName(t)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Body muted>
              {approved
                ? "Your photo shows, and only to someone who has pinned in and said they would like to meet at the same gathering."
                : "Your photo does not show yet — people see you without one until it is approved."}
            </Body>
            <View style={{ marginTop: spacing.sm }}>
              <Body muted>
                {me.instagram
                  ? "Your handle is not on this list. It appears once you share a crew or a 1-on-1 plan, or become connections."
                  : "No handle to show."}
              </Body>
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <Body muted>Your gender, birth year and email are on nobody's screen, including yours.</Body>
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: spacing.lg }}>
          <Link href="/settings" style={styles.link}>
            Safety &amp; settings
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
  card: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  face: { width: 76, height: 76, borderRadius: 38 },
  faceEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  faceLetter: { fontFamily: fonts.headline, fontSize: 28, color: palette.textMuted },
  name: { fontFamily: fonts.headline, fontSize: 22, color: palette.text },
  hood: { fontSize: 15, color: palette.textMuted, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13 },
  chipLabel: { fontSize: 14, color: palette.text },
  counts: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  count: { flex: 1, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.md },
  countNumber: { fontFamily: fonts.headline, fontSize: 22, color: palette.text },
  countLabel: { fontSize: 13, color: palette.textMuted, marginTop: 2 },
  sectionName: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginBottom: spacing.sm },
  preview: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    borderStyle: "dashed",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  link: { fontFamily: fonts.headline, fontSize: 16, color: palette.accentText },
});
