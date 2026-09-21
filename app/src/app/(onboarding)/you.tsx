// A2 — You. First name, date of birth, gender, a face photo.
//
// **Three rules this screen exists to keep, all of them in the database as well:**
//
//   * **Under 19 stops here, with no soft fail** (H8). Not a warning, not a nudge —
//     the button goes and the sentence is plain, because there is nothing to
//     negotiate and nothing to try again.
//   * **Only the YEAR is kept.** The full date is used to work out an age and is
//     never written anywhere, not to the database and not to a log (decisions Part 3).
//   * **Gender is asked once and appears on no profile, not even your own** (D1). The
//     line saying why is on the screen, because a protected attribute asked for
//     without a reason reads as nosy.
//
// The photo is optional *here* and required to be seen: a person with no photo is on
// no list, and a person whose photo was refused is on the list without one (V6). That
// difference is why the states have their own sentences.
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors as palette, GENDER_WHY, PHOTO_WHY, radius, spacing, UNDER_19 } from "@pind/shared";
import { Body, Button, Choice, Field, Heading, Notice } from "@/components/ui";
import { track } from "@/lib/analytics";
import { PhotoError, askForCheck, pickPhoto, uploadPhoto, type Picked } from "@/lib/photo";
import { supabase } from "@/lib/supabase";

type Gender = "woman" | "man" | "nonbinary" | "undisclosed";

const GENDERS = [
  { value: "woman", name: "Woman" },
  { value: "man", name: "Man" },
  { value: "nonbinary", name: "Nonbinary" },
  { value: "undisclosed", name: "Prefer not to say" },
] as const;

// Whole years, on the day. Written out rather than taken from a date library,
// because the only thing it has to get right is the birthday edge.
export function ageOn(day: number, month: number, year: number, now = new Date()): number | null {
  if (!day || !month || !year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCDate() !== day || birth.getUTCMonth() !== month - 1) return null; // 31 February
  let age = now.getUTCFullYear() - year;
  const hadBirthday =
    now.getUTCMonth() > month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  if (!hadBirthday) age -= 1;
  return age;
}

export default function You() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [womenOnly, setWomenOnly] = useState(false);
  const [photo, setPhoto] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const age = useMemo(() => ageOn(Number(day), Number(month), Number(year)), [day, month, year]);
  const tooYoung = age !== null && age < 19;
  const complete = firstName.trim().length > 0 && age !== null && age >= 19 && gender !== null;

  const choosePhoto = async () => {
    setError("");
    try {
      const picked = await pickPhoto();
      if (picked) setPhoto(picked);
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : "That photo could not be opened.");
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const db = supabase();
      const { data: session } = await db.auth.getUser();
      const authUserId = session.user?.id;
      if (!authUserId) throw new Error("Sign in again — this session has expired.");

      const photoPath = photo ? await uploadPhoto(authUserId, photo) : null;

      // The link path may already have made this row at a pin (A26), under the same
      // auth user. Insert or update, never upsert: `auth_user_id` is insert-only, so
      // an upsert would ask for a privilege the person does not have.
      const { data: mine } = await db.from("people").select("id").eq("auth_user_id", authUserId).maybeSingle();
      let personId = mine?.id ?? null;
      if (personId) {
        const { error: updateError } = await db
          .from("people")
          .update({ first_name: firstName.trim(), ...(photoPath ? { photo_path: photoPath } : {}) })
          .eq("id", personId);
        if (updateError) throw updateError;
      } else {
        const { data: made, error: insertError } = await db
          .from("people")
          .insert({ auth_user_id: authUserId, first_name: firstName.trim(), photo_path: photoPath })
          .select("id")
          .single();
        if (insertError) throw insertError;
        personId = made.id;
      }

      // Owner-only, and the year alone. `birth_year` cannot be updated later — the
      // grant does not include it — so this is asked once and answered once.
      const { error: privateError } = await db.from("people_private").upsert(
        {
          person_id: personId,
          gender: gender!,
          include_in_women_only: gender === "nonbinary" ? womenOnly : false,
          birth_year: Number(year),
          age_attested_at: new Date().toISOString(),
        },
        { onConflict: "person_id" },
      );
      if (privateError) throw privateError;

      // The net, after the webhook (which has already fired on the insert above).
      if (photoPath) void askForCheck();
      track("profile_created", { photo: !!photoPath });
      router.replace("/where");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Heading>A bit about you</Heading>
        <View style={{ marginBottom: spacing.lg }}>
          <Body muted>Your first name is what people see. Nothing else here is on your profile.</Body>
        </View>

        {error ? <Notice tone="stop">{error}</Notice> : null}

        <Field
          label="First name"
          value={firstName}
          onChangeText={setFirstName}
          autoComplete="given-name"
          maxLength={40}
          placeholder="Alex"
        />

        <Text style={styles.label}>Date of birth</Text>
        <View style={styles.dob}>
          <View style={styles.dobPart}>
            <Field label="Day" value={day} onChangeText={setDay} keyboardType="number-pad" inputMode="numeric" maxLength={2} placeholder="14" />
          </View>
          <View style={styles.dobPart}>
            <Field label="Month" value={month} onChangeText={setMonth} keyboardType="number-pad" inputMode="numeric" maxLength={2} placeholder="06" />
          </View>
          <View style={[styles.dobPart, { flex: 1.4 }]}>
            <Field label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" inputMode="numeric" maxLength={4} placeholder="1997" />
          </View>
        </View>
        <View style={{ marginBottom: spacing.md }}>
          <Body muted>We keep the year and throw the rest away.</Body>
        </View>

        {tooYoung ? <Notice tone="stop">{UNDER_19}</Notice> : null}

        <Choice label="Gender" hint={GENDER_WHY} options={GENDERS} value={gender} onChange={setGender} />
        {gender === "nonbinary" ? (
          <View style={{ marginBottom: spacing.md }}>
            <Choice
              label="Women-only crews"
              options={[
                { value: "yes", name: "Include me" },
                { value: "no", name: "Leave me out" },
              ]}
              value={womenOnly ? "yes" : "no"}
              onChange={(v) => setWomenOnly(v === "yes")}
            />
          </View>
        ) : null}

        <Text style={styles.label}>A photo of your face</Text>
        <View style={{ marginBottom: spacing.sm }}>
          <Body muted>{PHOTO_WHY}</Body>
        </View>
        <View style={styles.photoRow}>
          {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} /> : <View style={[styles.preview, styles.previewEmpty]} />}
          <View style={{ flex: 1 }}>
            <Button kind="quiet" label={photo ? "Choose another" : "Choose a photo"} onPress={choosePhoto} />
          </View>
        </View>
        <View style={{ marginBottom: spacing.lg }}>
          <Body muted>Nobody sees it until you have both pinned in to the same gathering and said you would like to meet.</Body>
        </View>

        <Button label="Continue" busy={busy} disabled={!complete} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: spacing.lg, paddingTop: spacing.xl },
  label: { fontSize: 14, color: palette.textMuted, marginBottom: spacing.xs + 2 },
  dob: { flexDirection: "row", gap: spacing.sm },
  dobPart: { flex: 1 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
  preview: { width: 72, height: 72, borderRadius: radius.md },
  previewEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
});
