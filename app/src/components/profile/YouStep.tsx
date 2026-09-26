// "You" — first name, date of birth, gender, a face photo. ONE step, drawn by A2 (the
// store path) and A27 (the link path) alike (Alex, M3.2 walk: they were two
// implementations of the same screen, and the women-only question had already drifted —
// yes/no on one, a tickbox on the other. "No amount of guarding fixes something that
// shouldn't have been duplicated.")
//
// **Rules this step keeps, all in the database as well:**
//   * **Under 19 stops here, with no soft fail** (H8). The sentence shows as soon as the
//     date says so. What happens next is the path's: the store path keeps Continue off;
//     A27 removes the pin and the person (`onUnder19`, P103).
//   * **Only the YEAR is kept.** The full date works out an age and is never written.
//   * **Gender is asked once and appears on no profile** (D1); the reason is on screen.
//     Women-only is asked of nonbinary people only, here and nowhere else.
//   * **Asked once:** someone who already gave a date of birth and gender (the other
//     path, or an earlier visit) is not asked again, and neither is a photo they have.
//
// The photo is optional on the store path and required on A27, where meeting people
// needs one (Q2, the gate). **Never a dead end** (M3.1): a photo can always be removed,
// and a failed upload says how to get out.
import { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import {
  type A2Photo,
  ageOn,
  canContinue,
  colors as palette,
  GENDER_CHOICES,
  GENDER_WHY,
  isOldEnough,
  PHOTO_LABEL,
  PHOTO_WHEN,
  PHOTO_WHY,
  photoActions,
  radius,
  removePhoto,
  spacing,
  UNDER_19,
  uploadFailed,
  uploadReason,
} from "@pind/shared";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Choice, Field, Notice } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { askForCheck, pickPhoto, uploadPhoto, type Picked } from "@/lib/photo";
import { saveYou } from "@/lib/profile";
import { report } from "@/lib/sentry";
import { myAuthId } from "@/lib/session";

type Gender = (typeof GENDER_CHOICES)[number]["value"];

export interface YouStepProps {
  firstName: string;
  hasPrivate: boolean;
  hasPhoto: boolean;
  photoRequired: boolean;
  onSaved: (done: { photo: boolean }) => void;
  // A27: under 19 removes the pin and the person. Absent on the store path, where the
  // step stops with the sentence and Continue stays off.
  onUnder19?: () => Promise<void>;
  continueLabel?: string;
}

export function YouStep({ firstName: initialName, hasPrivate, hasPhoto, photoRequired, onSaved, onUnder19, continueLabel = "Continue" }: YouStepProps) {
  const [firstName, setFirstName] = useState(initialName);
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [womenOnly, setWomenOnly] = useState(false);
  const [photo, setPhoto] = useState<A2Photo<Picked>>({ state: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Described | null>(null);

  const age = useMemo(() => ageOn(Number(day), Number(month), Number(year)), [day, month, year]);
  const tooYoung = !hasPrivate && age !== null && !isOldEnough(age);
  const detailsOk = hasPrivate ? firstName.trim().length > 0 : canContinue({ firstName, oldEnough: isOldEnough(age), gender });
  const photoOk = hasPhoto || !photoRequired || photo.state !== "none";
  // Under 19 with a consequence to run (A27) is a button that does it; without one, off.
  const enabled = tooYoung ? !!onUnder19 : detailsOk && photoOk;

  const choosePhoto = async () => {
    setError(null);
    try {
      const picked = await pickPhoto();
      if (picked) setPhoto({ state: "chosen", picked });
    } catch (err) {
      // A PhotoError is already a sentence written for the person (HEIC, too big,
      // permission refused), so it passes through rather than being re-described.
      setError(failed("open that photo", err));
    }
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (tooYoung) {
        if (onUnder19) await onUnder19();
        return;
      }
      // A failed upload stops here with the photo marked failed and removable; nothing
      // else has been written, so removing it and tapping Continue again goes on.
      let photoPath: string | null = null;
      if (!hasPhoto && photo.state !== "none") {
        try {
          photoPath = await uploadPhoto(await myAuthId(), photo.picked);
        } catch (err) {
          // The reason in words, never the error's own text (it printed a hostname, M3.1).
          report(err, "upload your photo");
          const next = uploadFailed(photo, uploadReason(err));
          setPhoto(next);
          if (next.state === "failed") setError({ says: next.says });
          return;
        }
      }
      await saveYou({
        firstName,
        birthYear: hasPrivate ? null : Number(year),
        gender: hasPrivate ? null : gender,
        womenOnly,
        photoPath,
      });
      // The net, after the webhook (which fired on the write above).
      if (photoPath) void askForCheck();
      onSaved({ photo: !!photoPath || hasPhoto });
    } catch (err) {
      setError(failed("save that", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Field label="First name" value={firstName} onChangeText={setFirstName} autoComplete="given-name" maxLength={40} placeholder="Alex" />

      {!hasPrivate ? (
        <>
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

          <Choice label="Gender" hint={GENDER_WHY} options={GENDER_CHOICES} value={gender} onChange={setGender} />
          {/* The one women-only question in the product (M3.2): nonbinary people only,
              an explicit choice rather than a tickbox that is easy to miss. */}
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
        </>
      ) : null}

      {!hasPhoto ? (
        <>
          <Text style={styles.label}>{PHOTO_LABEL}</Text>
          <View style={{ marginBottom: spacing.sm }}>
            <Body muted>{PHOTO_WHY}</Body>
          </View>
          {!photoRequired ? (
            <View style={{ marginBottom: spacing.sm }}>
              <Body muted>{PHOTO_WHEN}</Body>
            </View>
          ) : null}
          <View style={styles.photoRow}>
            {photo.state !== "none" ? (
              <Image source={{ uri: photo.picked.uri }} style={[styles.preview, photo.state === "failed" && { opacity: 0.4 }]} />
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
                  <Button key={action} kind="quiet" label={action === "choose" ? "Choose a photo" : "Choose another"} onPress={choosePhoto} />
                ),
              )}
            </View>
          </View>
          <View style={{ marginBottom: spacing.lg }}>
            <Body muted>Nobody sees it until you have both pinned in to the same gathering and said you would like to meet.</Body>
          </View>
        </>
      ) : null}

      {/* Beside the button that was tapped (CLAUDE.md: "seen" is part of a refusal). */}
      {error ? <Trouble what={error} onRetry={save} busy={busy} /> : null}
      <Button label={continueLabel} busy={busy} disabled={!enabled} onPress={save} />
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, color: palette.textMuted, marginBottom: spacing.xs + 2 },
  dob: { flexDirection: "row", gap: spacing.sm },
  dobPart: { flex: 1 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
  preview: { width: 72, height: 72, borderRadius: radius.md },
  previewEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
});
