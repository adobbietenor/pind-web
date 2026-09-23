// A photo's type is its bytes', and it reaches the wire (M3.1, from TestFlight).
//
// **The fault these fire on:** the app checked the picker's label, then uploaded a
// Blob; storage-js turned the Blob into multipart form data and dropped the content
// type, and Supabase recorded "text/plain". I01 reproduces that drop against the real
// storage-js, so the explanation is a test rather than a memory. I02 proves the upload
// the app now builds carries image/jpeg as the request's own header.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StorageClient } from "@supabase/storage-js";
import {
  decodeBase64,
  judgePhotoBytes,
  PHOTO_EMPTY,
  PHOTO_HEIC,
  PHOTO_TOO_BIG,
  PHOTO_UNKNOWN,
  photoUpload,
  sniffImageType,
} from "../../packages/shared/src/image.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftyp" + brand)]);

// storage-js, with a fetch that records what would have gone to Supabase.
function recordingStorage() {
  const sent: { contentType: string | null; body: unknown }[] = [];
  const fetchStub = (async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    sent.push({ contentType: headers.get("content-type"), body: init.body });
    return new Response(JSON.stringify({ Id: "x", Key: "photos/x" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { sent, bucket: new StorageClient("https://example.test/storage/v1", {}, fetchStub).from("photos") };
}

describe("What the upload actually sends", () => {
  it("I01 a Blob loses the content type — the TestFlight fault, reproduced", async () => {
    const { sent, bucket } = recordingStorage();
    // What `fetch(file://).blob()` gives in React Native: the bytes, with no type.
    await bucket.upload("u/1.jpg", new Blob([JPEG]), { contentType: "image/jpeg" });
    assert.ok(sent[0]!.body instanceof FormData, "a Blob went up as multipart");
    assert.notEqual(sent[0]!.contentType, "image/jpeg", "the contentType option reached the wire after all");
  });

  it("I02 the upload the app builds sends image/jpeg as its own header", async () => {
    const { sent, bucket } = recordingStorage();
    const verdict = judgePhotoBytes(JPEG);
    assert.ok(verdict.ok);
    const up = photoUpload("u", JPEG, verdict.contentType, 1);
    await bucket.upload(up.path, up.body, { contentType: up.contentType });
    assert.equal(sent[0]!.contentType, "image/jpeg");
    assert.ok(sent[0]!.body instanceof ArrayBuffer, "the body is the bytes, not a form");
    assert.deepEqual(new Uint8Array(sent[0]!.body as ArrayBuffer), JPEG);
    assert.equal(up.path, "u/1.jpg");
  });

  it("I03 a view into a larger buffer uploads only its own bytes", () => {
    const big = new Uint8Array([9, 9, ...PNG, 9]);
    const up = photoUpload("u", big.subarray(2, 2 + PNG.length), "image/png", 1);
    assert.deepEqual(new Uint8Array(up.body), PNG);
    assert.equal(up.path, "u/1.png");
  });
});

describe("The type is read from the bytes, never a label", () => {
  it("I04 JPEG, PNG and WebP are recognised by their first bytes", () => {
    assert.equal(sniffImageType(JPEG), "image/jpeg");
    assert.equal(sniffImageType(PNG), "image/png");
    assert.equal(sniffImageType(new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")])), "image/webp");
  });

  it("I05 HEIC and HEIF are refused by their bytes, with the HEIC sentence", () => {
    for (const brand of ["heic", "heix", "mif1"]) {
      const v = judgePhotoBytes(ftyp(brand));
      assert.deepEqual(v, { ok: false, says: PHOTO_HEIC }, brand);
    }
  });

  it("I06 bytes nobody recognises are refused, not assumed to be JPEG", () => {
    // The old code fell back to image/jpeg when the picker gave no type — a guard
    // that could never fire on the case it existed for.
    assert.deepEqual(judgePhotoBytes(new Uint8Array(Buffer.from("hello, not a picture"))), { ok: false, says: PHOTO_UNKNOWN });
    assert.deepEqual(judgePhotoBytes(new Uint8Array(0)), { ok: false, says: PHOTO_EMPTY });
    assert.equal(judgePhotoBytes(new Uint8Array(Buffer.from("GIF89a"))).ok, false);
  });

  it("I07 over 5 MB is refused, and exactly 5 MB is not", () => {
    const at = new Uint8Array(5 * 1024 * 1024);
    at.set(JPEG);
    assert.equal(judgePhotoBytes(at).ok, true);
    const over = new Uint8Array(5 * 1024 * 1024 + 1);
    over.set(JPEG);
    assert.deepEqual(judgePhotoBytes(over), { ok: false, says: PHOTO_TOO_BIG });
  });

  it("I08 base64 from the picker decodes to the same bytes", () => {
    for (const bytes of [JPEG, PNG, new Uint8Array([0]), new Uint8Array([1, 2]), new Uint8Array(0)]) {
      const b64 = Buffer.from(bytes).toString("base64");
      assert.deepEqual(decodeBase64(b64), bytes);
      assert.deepEqual(decodeBase64(`data:image/jpeg;base64,${b64}`), bytes);
    }
    assert.throws(() => decodeBase64("not*base64"));
  });
});
