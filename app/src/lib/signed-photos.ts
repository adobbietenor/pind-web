// Signed URLs for other people's faces, kept for their lifetime (the thread pass, 16 Oct 2026).
//
// A photo is served only by a short-lived signed URL, minted after the database's
// visibility check (can_see_photo, V6). Until this pass the room minted a fresh one for
// every face on every reload — and a new URL is a new image to the phone, so every
// message re-downloaded every avatar and the screen flickered. Now a URL is kept until
// it is close to expiry and only then signed again: the caller's own timer (the screen's
// shell refresh) is what renews it, never a message.
//
// Kept in the query cache, so sign-out's `queryClient.clear()` (S33) forgets them with
// everything else the last person could see. Holding a URL for its own lifetime shows
// nothing the URL did not already allow: it was signed for exactly this long.
//
// `faceSource` keys the image by its storage path, so a renewed URL for the same file is
// the same picture to expo-image and is not downloaded again. A new photo is a new file
// with a new path (Q17), so the key changes exactly when the picture does.
import { queryClient } from "./query";
import { supabase } from "./supabase";

export const PHOTO_URL_SECONDS = 300;
// Signed again once less than this is left — so a refresh every minute always renews in time.
const RENEW_MS = 90_000;
const key = (path: string) => ["signed-photo", path] as const;

export async function signedPhotoUrls(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const now = Date.now();
  const wanted = [...new Set(paths.filter((p): p is string => !!p))];
  const held = (p: string) => queryClient.getQueryData<{ url: string; until: number }>(key(p));
  const stale = wanted.filter((p) => (held(p)?.until ?? 0) - now < RENEW_MS);
  if (stale.length) {
    const { data } = await supabase().storage.from("photos").createSignedUrls(stale, PHOTO_URL_SECONDS);
    for (const s of data ?? []) {
      if (s.path && s.signedUrl) queryClient.setQueryData(key(s.path), { url: s.signedUrl, until: now + PHOTO_URL_SECONDS * 1000 });
      // Refused now (rejected, or no longer visible): forget the old one too.
      else if (s.path) queryClient.removeQueries({ queryKey: key(s.path), exact: true });
    }
  }
  const out = new Map<string, string>();
  for (const p of wanted) {
    const h = held(p);
    if (h && h.until > Date.now()) out.set(p, h.url);
  }
  return out;
}

export const faceSource = (url: string, path: string) => ({ uri: url, cacheKey: path });
