// A27 — Opt in (M3.2): the details that make "I'd like to meet up" real.
//
// Reached from A26 by someone who ticked "meet up" (the tick is intent — the opt-in
// gate, P105–P109), or later from the pinned crowd page's "Open to meeting". In the
// spec's order:
//
//   1. Date of birth — **under 19 stops here, no soft fail** (H8), and removes them
//      completely: the pin, the person, the 19+ record and the anonymous user
//      (`remove_me_under_19`, P103). Only the year is kept.
//   2. Gender (never shown to anyone; D1) and, for nonbinary, women-only crews.
//   3. A photo — required to be open to meeting (Q2). The same picker and states as A2.
//   4. A way to sign in — the email code on the SAME user (`updateUser` then
//      `verifyOtp`, type email_change): anonymous → permanent, same id, so the pin and
//      party size survive (P84). An address that already has an account is the merge
//      (decisions, M3.2), built next; until then that branch says so and loses nothing.
//   5. One safety sheet, where the privacy policy and terms are accepted.
//
// Only then is the pin opened — the database refuses it any earlier.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, StyleSheet, View } from "react-native";
import {
  type A2Photo,
  ageOn,
  colors as palette,
  GENDER_CHOICES,
  GENDER_WHY,
  isEmailTaken,
  isOldEnough,
  OPTIN_COPY,
  PHOTO_LABEL,
  PHOTO_WHY,
  photoActions,
  POLICY_VERSION,
  radius,
  removePhoto,
  spacing,
  uploadFailed,
  uploadReason,
  type GenderChoice,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Choice, Field, Heading, Tick } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { askForCheck, pickPhoto, uploadPhoto, type Picked } from "@/lib/photo";
import { report } from "@/lib/sentry";
import { myAuthId, whoAmI } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";
// The Worker is the same host on the web; the app on a phone names it.
const WORKER = Platform.OS === "web" ? "" : SITE;

type Step = "loading" | "details" | "contact" | "code" | "safety" | "removed";

interface Mine {
  personId: string;
  firstName: string;
  gatheringId: string;
  gatheringName: string;
  hasPrivate: boolean;
  hasPhoto: boolean;
}

export default function OptIn() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [mine, setMine] = useState<Mine | null>(null);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);

  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [gender, setGender] = useState<GenderChoice | null>(null);
  const [womenOnly, setWomenOnly] = useState(false);
  const [photo, setPhoto] = useState<A2Photo<Picked>>({ state: "none" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  // The merge (decisions, M3.2): the address already has an account. The anonymous
  // session is held here until the code proves the address, then both go to the
  // Worker together; on any failure after the code, it is put back, so "your pin is
  // still there" is true, not just said.
  const [merging, setMerging] = useState<{ access_token: string; refresh_token: string } | null>(null);

  const age = useMemo(() => ageOn(Number(day), Number(month), Number(year)), [day, month, year]);

  // Where this person stands: their pin at this gathering, and which details they
  // already have (someone who did A2 skips straight to what is missing).
  const load = useCallback(async () => {
    {
      const db = supabase();
      const userId = await myAuthId();
      // Read through RLS, not the public door, so a tester reaches the seed gathering.
      const { data: g, error: gErr } = await db.from("gatherings").select("id, name").eq("slug", slug).maybeSingle();
      if (gErr) throw gErr;
      const { data: me, error: meErr } = await db
        .from("people")
        .select("id, first_name, photo_path")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (meErr) throw meErr;
      if (!g || !me) {
        setTrouble({ says: "Pin in first — this page follows the pin." });
        setStep("details");
        return;
      }
      const { data: priv } = await db.from("people_private").select("person_id").eq("person_id", me.id).maybeSingle();
      const who = await whoAmI();
      const next: Mine = {
        personId: me.id,
        firstName: me.first_name,
        gatheringId: g.id,
        gatheringName: g.name,
        hasPrivate: !!priv,
        hasPhoto: !!me.photo_path,
      };
      setMine(next);
      const { data: session } = await db.auth.getSession();
      const anonymous = who.state === "in" && !!session.session?.user.is_anonymous;
      setStep(!next.hasPrivate || !next.hasPhoto ? "details" : anonymous ? "contact" : "safety");
    }
  }, [slug]);

  useEffect(() => {
    load().catch((err) => {
      setTrouble(failed("open this step", err));
      setStep("details");
    });
  }, [load]);

  const choosePhoto = async () => {
    setTrouble(null);
    try {
      const picked = await pickPhoto();
      if (picked) setPhoto({ state: "chosen", picked });
    } catch (err) {
      setTrouble(failed("open that photo", err));
    }
  };

  // 1–3: date of birth (and the under-19 stop), gender, photo.
  const saveDetails = async () => {
    if (!mine) return;
    setTrouble(null);
    if (!mine.hasPrivate && (age === null || gender === null)) return;
    if (!mine.hasPrivate && age !== null && !isOldEnough(age)) {
      setBusy(true);
      try {
        const { error } = await supabase().rpc("remove_me_under_19");
        if (error) throw error;
        await supabase().auth.signOut({ scope: "local" });
        setStep("removed");
      } catch (err) {
        setTrouble(failed("finish that", err));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!mine.hasPhoto && photo.state === "none") return;
    setBusy(true);
    const db = supabase();
    try {
      const userId = await myAuthId();
      if (!mine.hasPrivate) {
        // Only the year is kept (decisions Part 3); the full date is never written.
        const { error } = await db.from("people_private").insert({
          person_id: mine.personId,
          gender: gender!,
          include_in_women_only: gender === "nonbinary" ? womenOnly : false,
          birth_year: Number(year),
          age_attested_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
      if (!mine.hasPhoto && photo.state !== "none") {
        let path: string;
        try {
          path = await uploadPhoto(userId, photo.picked);
        } catch (err) {
          report(err, "upload your photo");
          const next = uploadFailed(photo, uploadReason(err));
          setPhoto(next);
          if (next.state === "failed") setTrouble({ says: next.says });
          return;
        }
        const { error } = await db.from("people").update({ photo_path: path }).eq("id", mine.personId);
        if (error) throw error;
        void askForCheck();
      }
      const updated = { ...mine, hasPrivate: true, hasPhoto: true };
      setMine(updated);
      const { data: session } = await db.auth.getSession();
      setStep(session.session?.user.is_anonymous ? "contact" : "safety");
    } catch (err) {
      setTrouble(failed("save that", err));
    } finally {
      setBusy(false);
    }
  };

  // 4: the email code, on the same user.
  const sendCode = async () => {
    setTrouble(null);
    setBusy(true);
    try {
      const { error } = await supabase().auth.updateUser({ email: email.trim().toLowerCase() });
      if (error) {
        if (isEmailTaken(error)) {
          const { data } = await supabase().auth.getSession();
          const held = data.session;
          if (!held) throw error;
          // A sign-in code to the existing account — never creating one.
          const sent = await supabase().auth.signInWithOtp({
            email: email.trim().toLowerCase(),
            options: { shouldCreateUser: false },
          });
          if (sent.error) throw sent.error;
          setMerging({ access_token: held.access_token, refresh_token: held.refresh_token });
          setTrouble({ says: OPTIN_COPY.emailHasAccount });
          setStep("code");
          return;
        }
        throw error;
      }
      setStep("code");
    } catch (err) {
      setTrouble(failed("send the code", err));
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    setTrouble(null);
    setBusy(true);
    if (merging) {
      await confirmMerge(merging);
      setBusy(false);
      return;
    }
    try {
      const { error } = await supabase().auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: "email_change",
      });
      if (error) throw error;
      setStep("safety");
    } catch (err) {
      setTrouble(failed("confirm that code", err));
    } finally {
      setBusy(false);
    }
  };

  // The merge: the code proves the address (only then does the app hold the account's
  // session), then both sessions go to the Worker, which checks each with the auth
  // server before anything moves.
  const confirmMerge = async (held: { access_token: string; refresh_token: string }) => {
    const db = supabase();
    const { data: signedIn, error: codeError } = await db.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    if (codeError || !signedIn.session) {
      // The code did not prove it: still anonymous, nothing moved.
      setTrouble(failed("confirm that code", codeError ?? new Error("no session")));
      return;
    }
    try {
      const res = await fetch(`${WORKER}/account/merge`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${signedIn.session.access_token}` },
        body: JSON.stringify({ anon_access_token: held.access_token }),
      });
      if (!res.ok) throw Object.assign(new Error(`merge ${res.status}`), { status: res.status });
      setMerging(null);
      await load();
    } catch (err) {
      // Put the anonymous session back: the pin is exactly where it was.
      report(err, "merge into the existing account");
      await db.auth.setSession(held).catch(() => undefined);
      setTrouble({ says: OPTIN_COPY.nothingLost, wayOut: "retry" });
    }
  };

  // 5: the safety sheet, then the pin opens — the gate allows it only now.
  const finish = async () => {
    if (!mine || !accepted) return;
    setTrouble(null);
    setBusy(true);
    try {
      // The version accepted, on record (M3.2, P110–P112): M4.1 asks again when it changes.
      const { error: acceptError } = await supabase()
        .from("policy_acceptances")
        .upsert({ person_id: mine.personId, version: POLICY_VERSION }, { onConflict: "person_id,version", ignoreDuplicates: true });
      if (acceptError) throw acceptError;
      const { error } = await supabase()
        .from("pins")
        .update({ open_to_meeting: true })
        .eq("person_id", mine.personId)
        .eq("gathering_id", mine.gatheringId);
      if (error) throw error;
      // Until A9 (the pinned crowd page) lands in this milestone, back to the pin.
      router.replace(`/pin/${slug}`);
    } catch (err) {
      setTrouble(failed("open you to meeting", err));
    } finally {
      setBusy(false);
    }
  };

  if (step === "loading") {
    return (
      <AppScreen scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  if (step === "removed") {
    return (
      <AppScreen>
        <Heading>{OPTIN_COPY.heading}</Heading>
        <Body>{OPTIN_COPY.under19Removed}</Body>
      </AppScreen>
    );
  }

  const tooYoung = age !== null && !isOldEnough(age);

  return (
    <AppScreen>
      <Heading>{OPTIN_COPY.heading}</Heading>
      <View style={{ marginBottom: spacing.lg }}>
        <Body muted>{mine ? `${mine.firstName} · ${mine.gatheringName}` : ""}</Body>
        <Body muted>{OPTIN_COPY.lede}</Body>
      </View>

      {step === "details" && mine ? (
        <>
          {!mine.hasPrivate ? (
            <>
              <View style={styles.dob}>
                <View style={styles.dobPart}>
                  <Field label="Day" value={day} onChangeText={setDay} keyboardType="number-pad" inputMode="numeric" maxLength={2} />
                </View>
                <View style={styles.dobPart}>
                  <Field label="Month" value={month} onChangeText={setMonth} keyboardType="number-pad" inputMode="numeric" maxLength={2} />
                </View>
                <View style={[styles.dobPart, { flex: 1.4 }]}>
                  <Field label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" inputMode="numeric" maxLength={4} />
                </View>
              </View>
              <Choice label="Gender" hint={GENDER_WHY} options={GENDER_CHOICES} value={gender} onChange={setGender} />
              {gender === "nonbinary" ? (
                <Tick label="Include me in women-only crews" value={womenOnly} onChange={setWomenOnly} />
              ) : null}
            </>
          ) : null}
          {!mine.hasPhoto ? (
            <View style={{ marginBottom: spacing.md }}>
              <Body>{PHOTO_LABEL}</Body>
              <Body muted>{PHOTO_WHY}</Body>
              <View style={styles.photoRow}>
                {photo.state !== "none" ? (
                  <Image source={{ uri: photo.picked.uri }} style={[styles.preview, photo.state === "failed" && { opacity: 0.4 }]} />
                ) : (
                  <View style={[styles.preview, styles.previewEmpty]} />
                )}
                <View style={{ flex: 1, gap: spacing.sm }}>
                  {photoActions(photo).map((action) =>
                    action === "remove" ? (
                      <Button key={action} kind="quiet" label="Remove photo" onPress={() => { setPhoto(removePhoto()); setTrouble(null); }} />
                    ) : (
                      <Button key={action} kind="quiet" label={action === "choose" ? "Choose a photo" : "Choose another"} onPress={choosePhoto} />
                    ),
                  )}
                </View>
              </View>
            </View>
          ) : null}
          {trouble ? <Trouble what={trouble} onRetry={saveDetails} busy={busy} /> : null}
          <Button
            label="Continue"
            busy={busy}
            disabled={(!mine.hasPrivate && (age === null || gender === null)) || (!mine.hasPhoto && photo.state === "none" && !tooYoung)}
            onPress={saveDetails}
          />
        </>
      ) : null}

      {step === "contact" ? (
        <>
          <Heading>{OPTIN_COPY.contactHeading}</Heading>
          <View style={{ marginBottom: spacing.md }}>
            <Body muted>{OPTIN_COPY.contactWhy}</Body>
          </View>
          <Field label={OPTIN_COPY.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" />
          {trouble ? <Trouble what={trouble} onRetry={sendCode} busy={busy} /> : null}
          <Button label={OPTIN_COPY.sendCode} busy={busy} disabled={!email.includes("@")} onPress={sendCode} />
        </>
      ) : null}

      {step === "code" ? (
        <>
          <View style={{ marginBottom: spacing.md }}>
            <Body muted>{OPTIN_COPY.codeSent}</Body>
          </View>
          <Field label={OPTIN_COPY.code} value={code} onChangeText={setCode} keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
          {trouble ? <Trouble what={trouble} onRetry={confirmCode} busy={busy} /> : null}
          <Button label={OPTIN_COPY.verify} busy={busy} disabled={code.trim().length < 6} onPress={confirmCode} />
        </>
      ) : null}

      {step === "safety" ? (
        <>
          <Heading>{OPTIN_COPY.safetyHeading}</Heading>
          <View style={styles.sheet}>
            {OPTIN_COPY.safety.map((line) => (
              <Body key={line}>{`•  ${line}`}</Body>
            ))}
          </View>
          <Tick label={OPTIN_COPY.accept} value={accepted} onChange={setAccepted} />
          <View style={{ flexDirection: "row", gap: spacing.md, marginBottom: spacing.md }}>
            <Button kind="quiet" label="Privacy" onPress={() => void Linking.openURL(`${SITE}/privacy`)} />
            <Button kind="quiet" label="Terms" onPress={() => void Linking.openURL(`${SITE}/terms`)} />
          </View>
          {trouble ? <Trouble what={trouble} onRetry={finish} busy={busy} /> : null}
          <Button label={OPTIN_COPY.finish} busy={busy} disabled={!accepted} onPress={finish} />
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  dob: { flexDirection: "row", gap: spacing.sm },
  dobPart: { flex: 1 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  preview: { width: 72, height: 72, borderRadius: radius.md },
  previewEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  sheet: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    marginBottom: spacing.md,
  },
});
