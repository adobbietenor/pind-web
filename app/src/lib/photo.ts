// Choosing and uploading a photo (A2, A27).
//
// **The type is read from the photo's bytes and sent as those bytes' own header.**
// The first TestFlight build uploaded a Blob, storage-js turned it into multipart form
// data and dropped our content type, and the server saw text/plain; the web only
// worked because its Blob happened to carry a type. The whole account, and the rules,
// are in `packages/shared/src/image.ts`.
//
// HEIC is still why this has a shape: an iPhone's default camera format is HEIC, and
// the Anthropic API cannot read it. Three layers, none of them a new dependency:
//
//   1. `allowsEditing` makes the picker re-encode the crop as JPEG;
//   2. `judgePhotoBytes` refuses what the check cannot read — by its bytes, not a
//      label — before a byte is uploaded, and says so to the person;
//   3. one that gets through anyway becomes a RECORDED failure the admin counts
//      (`photo_checks`), never a photo nothing ever looked at.
//
// The photo goes to the private `photos` bucket, in a folder named after the auth
// user id, which is the only place RLS lets anyone write (V6).

import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { decodeBase64, judgePhotoBytes, photoUpload, type ReadableType } from "@pind/shared";
import { supabase } from "./supabase";

// The Worker and the web export share one host (decisions Part 5, "Web build
// hosting"), so on the web the route is relative. In the app there is no origin to
// be relative to, and the host is the same one every share link uses.
const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";
const worker = (path: string) => (Platform.OS === "web" ? path : `${SITE}${path}`);

export interface Picked {
  uri: string; // for the preview only
  bytes: Uint8Array;
  contentType: ReadableType;
}

export class PhotoError extends Error {}

// Square, re-encoded, and not enormous. `quality` is the JPEG quality the crop is
// written at; 0.8 is well inside the 5 MB bucket limit for any phone camera.
// `base64` hands us the bytes the picker wrote, on the phone and on the web alike.
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
    base64: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const bytes = asset.base64
    ? decodeBase64(asset.base64)
    : new Uint8Array(await (await fetch(asset.uri)).arrayBuffer());
  const verdict = judgePhotoBytes(bytes);
  // Named, rather than a generic failure later: HEIC is the one that will actually
  // happen, and "your photo could not be checked" tells nobody what to do.
  if (!verdict.ok) throw new PhotoError(verdict.says);
  return { uri: asset.uri, bytes, contentType: verdict.contentType };
}

// Uploads into the person's own folder and returns the object name that goes on
// `people.photo_path`. Replacing a photo sends the row back to `pending` (a database
// trigger), so nothing here has to remember to.
export async function uploadPhoto(authUserId: string, picked: Picked): Promise<string> {
  const upload = photoUpload(authUserId, picked.bytes, picked.contentType);
  const { error } = await supabase().storage.from("photos").upload(upload.path, upload.body, {
    contentType: upload.contentType,
    upsert: false,
  });
  if (error) throw new PhotoError(error.message);
  return upload.path;
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
