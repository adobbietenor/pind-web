// Choosing and uploading a face photo (A2, A27).
//
// **HEIC is the whole reason this file has a shape.** An iPhone's default camera
// format is HEIC; the private bucket accepts it and the Anthropic API cannot read it,
// so without a conversion the automated check would have failed for most real uploads
// on day one. Two components disagreeing about what is valid, which is the same shape
// as the M2.3 map keys. Three layers, none of them a new dependency:
//
//   1. `allowsEditing` makes the picker re-encode the crop as JPEG, which is also the
//      square a face wants;
//   2. this file refuses a type the API cannot read, before a byte is uploaded, and
//      says so to the person;
//   3. one that gets through anyway becomes a RECORDED failure the admin counts
//      (`photo_checks`), never a photo nothing ever looked at.
//
// The photo goes to the private `photos` bucket, in a folder named after the auth
// user id, which is the only place RLS lets anyone write (V6).

import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// The Worker and the web export share one host (decisions Part 5, "Web build
// hosting"), so on the web the route is relative. In the app there is no origin to
// be relative to, and the host is the same one every share link uses.
const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";
const worker = (path: string) => (Platform.OS === "web" ? path : `${SITE}${path}`);

// What the check can read. Kept in step with src/photo/ai.ts's SUPPORTED — the
// Worker's copy is the one that matters, this one only saves a wasted upload.
const READABLE = ["image/jpeg", "image/png", "image/webp"];

export interface Picked {
  uri: string;
  contentType: string;
}

export class PhotoError extends Error {}

// Square, re-encoded, and not enormous. `quality` is the JPEG quality the crop is
// written at; 0.8 is well inside the 5 MB bucket limit for any phone camera.
export async function pickPhoto(): Promise<Picked | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new PhotoError("Pin'd needs permission to open your photos. You can change that in Settings.");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const contentType = (asset.mimeType ?? "image/jpeg").split(";")[0]!.toLowerCase();
  if (!READABLE.includes(contentType)) {
    // Named, rather than a generic failure later: HEIC is the one that will actually
    // happen, and "your photo could not be checked" tells nobody what to do.
    throw new PhotoError(
      contentType === "image/heic" || contentType === "image/heif"
        ? "That photo is in Apple's HEIC format, which we cannot read. Crop it when you pick it and we will get a readable copy."
        : `We cannot read ${contentType}. A JPEG or PNG works.`,
    );
  }
  return { uri: asset.uri, contentType };
}

// Uploads into the person's own folder and returns the object name that goes on
// `people.photo_path`. Replacing a photo sends the row back to `pending` (a database
// trigger), so nothing here has to remember to.
export async function uploadPhoto(authUserId: string, picked: Picked): Promise<string> {
  const response = await fetch(picked.uri);
  const blob = await response.blob();
  if (blob.size > 5 * 1024 * 1024) throw new PhotoError("That photo is over 5 MB. Try cropping it smaller.");
  const extension = picked.contentType === "image/png" ? "png" : picked.contentType === "image/webp" ? "webp" : "jpg";
  // A new name every time, so a replaced photo never collides with a signed URL that
  // is still in flight for the old one.
  const path = `${authUserId}/${Date.now()}.${extension}`;
  const { error } = await supabase().storage.from("photos").upload(path, blob, {
    contentType: picked.contentType,
    upsert: false,
  });
  if (error) throw new PhotoError(error.message);
  return path;
}

// **The net, not the mechanism** (CLAUDE.md). The database webhook is what normally
// starts the check; this call only covers a webhook that did not fire. It is fired
// and forgotten on purpose: the person is not made to wait on it, and a failure here
// is not a failure of their upload.
export async function askForCheck(): Promise<void> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;
  try {
    await fetch(worker("/photo-check"), { method: "POST", headers: { authorization: `Bearer ${token}` } });
  } catch {
    // Deliberately silent: the webhook is the mechanism, and the admin counts a photo
    // nothing has looked at.
  }
}
