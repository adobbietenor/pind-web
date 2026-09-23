// Profile → Change photo (A21, M3.1).
//
// **A bug before it was a screen** (Alex, walking the TestFlight build): Remove and
// Choose another existed during A2 and disappeared after it, so somebody with a bad
// photo was stuck with it — and "nothing waits on the check" assumes a photo is easy
// to swap. The same picker and the same states as A2 (`@pind/shared`, a2photo.ts:
// A07–A10), plus the photo already on the profile.
//
// **Never a dead end here either.** A failed upload is marked failed, says how to get
// out, and Remove discards it and leaves the photo that was already there.
//
// Saving a new photo sends it back to `pending` (a database trigger) and it shows at
// once — nothing waits on the check. The old file is deleted from the person's folder
// afterwards: a replaced photo is not kept.
//
// **Offline is its own state, never "no profile"** (M3.1, the airplane-mode walk). The
// screen used to ask `getUser()` — a network call — and read offline as nobody, after
// which Save quietly went back without saving. Now a load that could not arrive says
// so with Try again, and the upload is what fails when the network is off.
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import {
  colors as palette,
  editActions,
  editChoose,
  editPlan,
  editRemove,
  editShows,
  PHOTO_WHY,
  radius,
  spacing,
  startEdit,
  uploadFailed,
  uploadReason,
  Said,
  type PhotoEdit,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { askForCheck, pickPhoto, uploadPhoto, type Picked } from "@/lib/photo";
import { loadMe, photoUrl } from "@/lib/profile";
import { report } from "@/lib/sentry";
import { myAuthId } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export default function ChangePhoto() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; authId: string } | null>(null);
  const [edit, setEdit] = useState<PhotoEdit<Picked> | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [error, setError] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadTrouble, setLoadTrouble] = useState<Described | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoadTrouble(null);
    (async () => {
      const authId = await myAuthId();
      const loaded = await loadMe();
      if (!live) return;
      if (!loaded) throw new Said("There is no profile on this account yet.");
      setMe({ id: loaded.id, authId });
      setEdit(startEdit(loaded.photoPath));
      if (loaded.photoPath) setCurrentUrl(await photoUrl(loaded.photoPath).catch(() => null));
    })().catch((err) => live && setLoadTrouble(failed("load your photo", err)));
    return () => {
      live = false;
    };
  }, [attempt]);

  if (loadTrouble) {
    return (
      <AppScreen>
        <Heading>Your photo</Heading>
        <Trouble what={loadTrouble} onRetry={() => setAttempt((n) => n + 1)} />
        <Button kind="quiet" label="Back to your profile" onPress={() => router.back()} />
      </AppScreen>
    );
  }

  if (!edit || !me) {
    return (
      <AppScreen scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  const choose = async () => {
    setError(null);
    try {
      const picked = await pickPhoto();
      if (picked) setEdit(editChoose(edit, picked));
    } catch (err) {
      setError(failed("open that photo", err));
    }
  };

  const save = async () => {
    const plan = editPlan(edit);
    if (plan === "nothing") return router.back();
    setBusy(true);
    setError(null);
    const db = supabase();
    try {
      let next: string | null = null;
      if (plan === "upload" && edit.pick.state !== "none") {
        try {
          next = await uploadPhoto(me.authId, edit.pick.picked);
        } catch (err) {
          // In words, never the error's own text (it printed a hostname, M3.1).
          report(err, "upload your photo");
          const marked = uploadFailed(edit.pick, uploadReason(err));
          setEdit({ ...edit, pick: marked });
          // Its way out is on the screen already: Remove photo, or Choose another.
          if (marked.state === "failed") setError({ says: marked.says });
          return;
        }
      }
      const { error: saveError } = await db.from("people").update({ photo_path: next }).eq("id", me.id);
      if (saveError) throw saveError;
      // The old file goes. Best effort: the profile no longer points at it either way.
      if (edit.current && edit.current !== next) await db.storage.from("photos").remove([edit.current]);
      if (next) void askForCheck();
      router.back();
    } catch (err) {
      setError(failed(plan === "clear" ? "remove your photo" : "save your photo", err));
    } finally {
      setBusy(false);
    }
  };

  const shows = editShows(edit);
  const previewUri = shows === "pick" && edit.pick.state !== "none" ? edit.pick.picked.uri : shows === "current" ? currentUrl : null;

  return (
    <AppScreen>
      <Heading>Your photo</Heading>
      <View style={{ marginBottom: spacing.md }}>
        <Body muted>{PHOTO_WHY}</Body>
      </View>

      {error ? <Trouble what={error} onRetry={save} busy={busy} /> : null}

      <View style={styles.row}>
        {previewUri ? (
          <Image
            source={{ uri: previewUri }}
            style={[styles.preview, edit.pick.state === "failed" && { opacity: 0.4 }]}
          />
        ) : (
          <View style={[styles.preview, styles.empty]} />
        )}
        <View style={{ flex: 1, gap: spacing.sm }}>
          {editActions(edit).map((action) =>
            action === "remove" ? (
              <Button
                key={action}
                kind="quiet"
                label="Remove photo"
                onPress={() => {
                  setEdit(editRemove(edit));
                  setError(null);
                }}
              />
            ) : (
              <Button
                key={action}
                kind="quiet"
                label={action === "choose" ? "Choose a photo" : "Choose another"}
                onPress={choose}
              />
            ),
          )}
        </View>
      </View>

      {shows === "nothing" && edit.current ? (
        <View style={{ marginBottom: spacing.md }}>
          <Body muted>Saving takes your photo off your profile. You will need one before you can meet up with anyone.</Body>
        </View>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        <Button label="Save" busy={busy} onPress={save} />
      </View>
      <View style={{ marginTop: spacing.sm }}>
        <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  preview: { width: 96, height: 96, borderRadius: radius.md },
  empty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
});
