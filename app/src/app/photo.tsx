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
  type PhotoEdit,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Body, Button, Heading, Notice } from "@/components/ui";
import { failed, oneLine } from "@/lib/errors";
import { PhotoError, askForCheck, pickPhoto, uploadPhoto, type Picked } from "@/lib/photo";
import { loadMe, photoUrl } from "@/lib/profile";
import { supabase } from "@/lib/supabase";

export default function ChangePhoto() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; authId: string } | null>(null);
  const [edit, setEdit] = useState<PhotoEdit<Picked> | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [loaded, user] = await Promise.all([loadMe().catch(() => null), supabase().auth.getUser()]);
      if (!live) return;
      if (!loaded || !user.data.user) {
        setEdit(startEdit(null));
        return;
      }
      setMe({ id: loaded.id, authId: user.data.user.id });
      setEdit(startEdit(loaded.photoPath));
      if (loaded.photoPath) setCurrentUrl(await photoUrl(loaded.photoPath).catch(() => null));
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!edit) {
    return (
      <AppScreen scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  const choose = async () => {
    setError("");
    try {
      const picked = await pickPhoto();
      if (picked) setEdit(editChoose(edit, picked));
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : oneLine(failed("open that photo", err)));
    }
  };

  const save = async () => {
    const plan = editPlan(edit);
    if (plan === "nothing" || !me) return router.back();
    setBusy(true);
    setError("");
    const db = supabase();
    try {
      let next: string | null = null;
      if (plan === "upload" && edit.pick.state !== "none") {
        try {
          next = await uploadPhoto(me.authId, edit.pick.picked);
        } catch (err) {
          const marked = uploadFailed(edit.pick, err instanceof Error ? err.message : String(err));
          setEdit({ ...edit, pick: marked });
          if (marked.state === "failed") setError(marked.says);
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
      setError(oneLine(failed(plan === "clear" ? "remove your photo" : "save your photo", err)));
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

      {error ? <Notice tone="stop">{error}</Notice> : null}

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
                  setError("");
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
