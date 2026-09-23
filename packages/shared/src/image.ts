// A photo's real type, read from its bytes, and the upload built from them (A2, A27).
//
// **Found in the first TestFlight build (Alex, M3.1):** "mime type text/plain is not
// supported", and A2 with no way forward. The app checked the picker's LABEL
// (`asset.mimeType`, or "image/jpeg" when there was none), then uploaded a Blob made
// by `fetch(file://)`. Handed a Blob, storage-js sends multipart form data and
// **ignores the `contentType` option entirely** — the part carries the Blob's own
// type, which in React Native is empty, so the server recorded text/plain. On the web
// the Blob happened to carry image/jpeg, which is why the web worked all weekend. The
// type that was checked was never the type that was sent, and the HEIC check was
// reading a label rather than the file.
//
// So, at the source: **the type is read from the file's first bytes, and those same
// bytes are sent with that type as the request's own Content-Type header.** Nothing
// between the decision and the wire can replace it. A label is not consulted at all.
//
// Pure, and in `@pind/shared`, so `node --test` proves it (tests/unit/image.test.ts):
// a rule that exists to refuse something is proved by a test that makes it refuse.

// What the photo check can read; kept in step with src/photo/ai.ts's SUPPORTED.
export const PHOTO_READABLE = ["image/jpeg", "image/png", "image/webp"] as const;
export type ReadableType = (typeof PHOTO_READABLE)[number];

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

// The magic numbers. Anything unrecognised is null — never a guess.
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  // ISO base media: "ftyp" at offset 4, then the major brand.
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].includes(brand)) return "image/heic";
    if (["mif1", "msf1", "avif"].includes(brand)) return brand === "avif" ? "image/avif" : "image/heif";
  }
  return null;
}

export const PHOTO_HEIC =
  "That photo is in Apple's HEIC format, which we cannot read. Crop it when you pick it and we will get a readable copy.";
export const PHOTO_UNKNOWN = "We could not tell what kind of picture that is. A JPEG or PNG works.";
export const PHOTO_TOO_BIG = "That photo is over 5 MB. Try cropping it smaller.";
export const PHOTO_EMPTY = "That photo came through empty. Try choosing it again.";

export type PhotoVerdict = { ok: true; contentType: ReadableType } | { ok: false; says: string };

export function judgePhotoBytes(bytes: Uint8Array): PhotoVerdict {
  if (bytes.length === 0) return { ok: false, says: PHOTO_EMPTY };
  const type = sniffImageType(bytes);
  if (type === "image/heic" || type === "image/heif") return { ok: false, says: PHOTO_HEIC };
  if (!type || !(PHOTO_READABLE as readonly string[]).includes(type)) {
    return { ok: false, says: type ? `We cannot read ${type}. A JPEG or PNG works.` : PHOTO_UNKNOWN };
  }
  if (bytes.length > PHOTO_MAX_BYTES) return { ok: false, says: PHOTO_TOO_BIG };
  return { ok: true, contentType: type as ReadableType };
}

const EXTENSION: Record<ReadableType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Everything `storage.from("photos").upload()` is given. `body` is an ArrayBuffer —
// **never a Blob** — because only a non-Blob body makes storage-js send
// `contentType` as the Content-Type header.
export function photoUpload(
  authUserId: string,
  bytes: Uint8Array,
  contentType: ReadableType,
  now = Date.now(),
): { path: string; body: ArrayBuffer; contentType: ReadableType } {
  // A copy of exactly these bytes: a view's `.buffer` can be larger than the view.
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  // A new name every time, so a replaced photo never collides with a signed URL that
  // is still in flight for the old one.
  return { path: `${authUserId}/${now}.${EXTENSION[contentType]}`, body, contentType };
}

// base64 → bytes, without relying on `atob` being present in every JS engine.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;
LOOKUP["-".charCodeAt(0)] = 62;
LOOKUP["_".charCodeAt(0)] = 63;

export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/^data:[^,]*,/, "").replace(/[\s=]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = LOOKUP[clean.charCodeAt(i)] ?? -1;
    if (v < 0) throw new Error("Not base64");
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}
