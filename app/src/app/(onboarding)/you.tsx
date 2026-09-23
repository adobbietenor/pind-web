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
//
// **And this screen is never a dead end** (Alex, M3.1, from TestFlight): a photo can
// always be removed, and no photo state blocks Continue. The states and the rule live
// in `@pind/shared` (a2photo.ts), where tests/unit/a2photo.test.ts walks a failed
// upload through to a saved profile.
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  type A2Photo,
  ageOn,
  canContinue,
  photoActions,
  removePhoto,
  savePlan,
  uploadFailed,
  colors as palette,
  GENDER_WHY,
  isOldEnough,
  PHOTO_LABEL,
  PHOTO_WHEN,
  PHOTO_WHY,
  radius,
  spacing,
  UNDER_19,
} from "@pind/shared";
import { Brand } from "@/components/Brand";
import { Body, Button, Choice, Field, Heading, Notice } from "@/components/ui";
import { track } from "@/lib/analytics";
import { failed, type Described } from "@/lib/errors";
import { PhotoError, askForCheck, pickPhoto, uploadPhoto, type Picked } from "@/lib/photo";
import { supabase } from "@/lib/supabase";

type Gender = "woman" | "man" | "nonbinary" | "undisclosed";

const GENDERS = [
  { value: "woman", name: "Woman" },
  { value: "man", name: "Man" },
  { value: "nonbinary", name: "Nonbinary" },
  { value: "undisclosed", name: "Prefer not to say" },
] as const;

export default function You() {
  const router = useRouter();
  // **This screen is where an OAuth sign-in lands**, and the session arrives WITH the
  // URL rather than before it. Until M3.1 the screen assumed a session was already
  // there and, when it was not, told the person it had EXPIRED — which was both wrong
  // and alarming: it had never existed. Waiting for it, and saying the true thing if
  // it never comes, is the whole of this state.
  const [auth, setAuth] = useState<"waiting" | "ready" | "none">("waiting");
  const arrivedFromUrl = useRef(false);
  const [firstName, setFirstName] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [womenOnly, setWomenOnly] = useState(false);
  const [photo, setPhoto] = useState<A2Photo<Picked>>({ state: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Described | null>(null);

  useEffect(() => {
    let live = true;
    const db = supabase();
    db.auth.getSession().then(({ data }) => {
      if (live && data.session) setAuth("ready");
    });
    // detectSessionInUrl finishes asynchronously after a return from Google or Apple;
    // this is what says it landed.
    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      if (!live || !session) return;
      arrivedFromUrl.current = true;
      setAuth("ready");
    });
    // Bounded, so a redirect that brings nothing back ends in a sentence rather than
    // a spinner nobody can get out of.
    const giveUp = setTimeout(() => {
      if (live) setAuth((was) => (was === "waiting" ? "none" : was));
    }, 8000);
    return () => {
      live = false;
      sub.subscription.unsubscribe();
      clearTimeout(giveUp);
    };
  }, []);

  useEffect(() => {
    if (auth === "ready" && arrivedFromUrl.current) track("sign_in", { method: "oauth_web" });
  }, [auth]);

  const age = useMemo(() => ageOn(Number(day), Number(month), Number(year)), [day, month, year]);
  const tooYoung = age !== null && !isOldEnough(age);
  // **The photo is deliberately not in this list.** A photo is required to opt in to
  // meeting people at a gathering (A27, Q2 revised) — never to pin, and never to have
  // a profile. Blocking here would move a rule to the wrong screen and stop somebody
  // finishing a profile they are entitled to.
  const complete = canContinue({ firstName, oldEnough: isOldEnough(age), gender });

  const choosePhoto = async () => {
    setError(null);
    try {
      const picked = await pickPhoto();
      if (picked) setPhoto({ state: "chosen", picked });
    } catch (err) {
      // A PhotoError is already a sentence written for the person — HEIC, too big,
      // permission refused — so it is passed through rather than re-described.
      setError(err instanceof PhotoError ? { says: err.message } : failed("open that photo", err));
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    // Each step says what it was doing, so a failure names the thing that failed
    // rather than the screen. "That did not save" gave neither of us anything.
    let doing = "finish signing you in";
    try {
      const db = supabase();
      const { data: session } = await db.auth.getUser();
      const authUserId = session.user?.id;
      if (!authUserId) {
        setError({ says: "We lost your sign-in. Go back and sign in again — nothing here was saved." });
        setBusy(false);
        return;
      }

      // A failed upload stops here with the photo marked failed and removable; the
      // rest of the profile is untouched, so removing it and tapping Continue again
      // finishes the screen without one.
      let photoPath: string | null = null;
      if (savePlan(photo).includes("upload") && photo.state !== "none") {
        try {
          photoPath = await uploadPhoto(authUserId, photo.picked);
        } catch (err) {
          const next = uploadFailed(photo, err instanceof Error ? err.message : String(err));
          setPhoto(next);
          if (next.state === "failed") setError({ says: next.says });
          return;
        }
      }

      // The link path may already have made this row at a pin (A26), under the same
      // auth user. Insert or update, never upsert: `auth_user_id` is insert-only, so
      // an upsert would ask for a privilege the person does not have.
      doing = "save your profile";
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

      // **Never an upsert here, and this cost a walk.** `people_private` is granted
      // INSERT on all five columns and UPDATE on two — `gender` and
      // `include_in_women_only` — because a birth year is asked once and must not be
      // editable afterwards. An upsert is `INSERT ... ON CONFLICT DO UPDATE`, and
      // Postgres checks UPDATE privileges on every column in the DO UPDATE clause
      // **statically**, before it knows whether the row exists. So the first insert
      // of a brand-new person was refused, 42501, for an update branch that would
      // never run. The grant is right; the statement was wrong.
      doing = "save your date of birth and gender";
      const { data: priv } = await db.from("people_private").select("person_id").eq("person_id", personId).maybeSingle();
      const privateError = priv
        ? (
            await db
              .from("people_private")
              .update({ gender: gender!, include_in_women_only: gender === "nonbinary" ? womenOnly : false })
              .eq("person_id", personId)
          ).error
        : (
            await db.from("people_private").insert({
              person_id: personId,
              gender: gender!,
              include_in_women_only: gender === "nonbinary" ? womenOnly : false,
              birth_year: Number(year),
              age_attested_at: new Date().toISOString(),
            })
          ).error;
      if (privateError) throw privateError;

      // The net, after the webhook (which has already fired on the insert above).
      if (photoPath) void askForCheck();
      track("profile_created", { photo: !!photoPath });
      router.replace("/where");
    } catch (err) {
      setError(failed(doing, err));
    } finally {
      setBusy(false);
    }
  };

  if (auth === "waiting") {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
        <ScrollView contentContainerStyle={styles.body}>
        <Brand />
          <Heading>Finishing your sign-in</Heading>
          <ActivityIndicator style={{ marginTop: spacing.lg }} color={palette.textMuted} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (auth === "none") {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
        <ScrollView contentContainerStyle={styles.body}>
        <Brand />
          <Heading>That sign-in did not come back</Heading>
          <View style={{ marginBottom: spacing.lg }}>
            <Body muted>
              Nothing was saved, and nothing went wrong on your side. Try again — the email code is the quickest way in.
            </Body>
          </View>
          <Button label="Back to sign in" onPress={() => router.replace("/sign-in")} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Brand />
        <Heading>A bit about you</Heading>
        <View style={{ marginBottom: spacing.lg }}>
          <Body muted>Your first name is what people see. Nothing else here is on your profile.</Body>
        </View>

        {error ? (
          <Notice tone="stop">
            {error.says}
            {error.detail ? `\n${error.detail}` : ""}
          </Notice>
        ) : null}

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

        <Text style={styles.label}>{PHOTO_LABEL}</Text>
        <View style={{ marginBottom: spacing.sm }}>
          <Body muted>{PHOTO_WHY}</Body>
        </View>
        <View style={{ marginBottom: spacing.sm }}>
          <Body muted>{PHOTO_WHEN}</Body>
        </View>
        <View style={styles.photoRow}>
          {photo.state !== "none" ? (
            <Image
              source={{ uri: photo.picked.uri }}
              style={[styles.preview, photo.state === "failed" && { opacity: 0.4 }]}
            />
          ) : (
            <View style={[styles.preview, styles.previewEmpty]} />
          )}
          <View style={{ flex: 1, gap: spacing.sm }}>
            {photoActions(photo).map((action) =>
              action === "remove" ? (
                <Button
                  key={action}
                  kind="quiet"
                  label="Remove photo"
                  onPress={() => {
                    setPhoto(removePhoto());
                    setError(null);
                  }}
                />
              ) : (
                <Button
                  key={action}
                  kind="quiet"
                  label={action === "choose" ? "Choose a photo" : "Choose another"}
                  onPress={choosePhoto}
                />
              ),
            )}
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
