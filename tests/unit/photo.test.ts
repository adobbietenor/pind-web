// The automated photo check's pure parts (Phase 3 M3.1): reading the model's answer,
// and deciding whether an image is one the API can actually read. No live API calls.
// Run with `npm run test:unit`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ESTIMATE_PER_PHOTO, parseVerdict, PHOTO_SYSTEM } from "../../src/photo/ai.ts";
import { mediaTypeOf } from "../../src/photo/check.ts";

describe("Reading the verdict — an answer that is not a verdict decides nothing", () => {
  it("H01 each of the three outcomes maps to the database's own word", () => {
    assert.deepEqual(parseVerdict(JSON.stringify({ outcome: "approve", reason: "Clear single face." })), {
      outcome: "approved",
      reason: "Clear single face.",
    });
    assert.equal(parseVerdict(JSON.stringify({ outcome: "reject", reason: "Nudity." }))?.outcome, "rejected");
    assert.equal(
      parseVerdict(JSON.stringify({ outcome: "needs_review", reason: "Could be under 19." }))?.outcome,
      "needs_review",
    );
  });

  it("H02 a refusal, a cut-off answer or an unknown outcome is null, never a decision", () => {
    // Null matters: the caller records a FAILED check, which leaves the photo pending
    // and countable, rather than inventing an approval or a rejection.
    assert.equal(parseVerdict("I can't help with that."), null);
    assert.equal(parseVerdict('{"outcome":"appro'), null);
    assert.equal(parseVerdict(JSON.stringify({ outcome: "maybe", reason: "?" })), null);
    assert.equal(parseVerdict(JSON.stringify({ reason: "no outcome" })), null);
    assert.equal(parseVerdict("null"), null);
    assert.equal(parseVerdict("[]"), null);
  });

  it("H03 a missing or oversized reason never blocks a verdict", () => {
    assert.equal(parseVerdict(JSON.stringify({ outcome: "approve" }))?.reason, "");
    const long = parseVerdict(JSON.stringify({ outcome: "approve", reason: "x".repeat(500) }));
    assert.equal(long?.reason.length, 200);
  });
});

describe("The rubric says the things it must", () => {
  it("H04 the check may never decide age on its own (H8), and leans to needs_review", () => {
    assert.match(PHOTO_SYSTEM, /under 19\. Never decide this yourself/);
    assert.match(PHOTO_SYSTEM, /Lean to needs_review/);
    // The two outcomes that hide a photo must be described as different things.
    assert.match(PHOTO_SYSTEM, /wrong reject takes someone's photo away/);
  });

  it("H05 the estimate is above what a call is expected to cost, never below", () => {
    // An estimate that runs under the real cost is worse than one that runs over: it
    // is what an aborted call is billed at, and an aborted call's usage never
    // arrives (M1.3b). ~$0.004 expected, two cents recorded.
    assert.ok(ESTIMATE_PER_PHOTO >= 0.01, "the estimate must leave room for a big image and a retry");
  });
});

describe("Images the API can read — HEIC is a fault, not a silent pass", () => {
  it("H06 the blob's own type wins, and the extension answers when it is missing", () => {
    assert.equal(mediaTypeOf("u/a.jpg", "image/jpeg"), "image/jpeg");
    assert.equal(mediaTypeOf("u/a.png", "image/png;charset=binary"), "image/png");
    assert.equal(mediaTypeOf("u/a.webp", undefined), "image/webp");
    assert.equal(mediaTypeOf("u/a.JPEG", ""), "image/jpeg");
  });

  it("H07 HEIC is refused by name: the bucket accepts it and the API does not", () => {
    // The app uploads JPEG for this reason (A2, A27). When one gets through anyway it
    // becomes a recorded failure that the admin counts, not a photo nothing looked at.
    assert.equal(mediaTypeOf("u/a.heic", "image/heic"), null);
    assert.equal(mediaTypeOf("u/a.HEIC", undefined), null);
    assert.equal(mediaTypeOf("u/a.pdf", "application/pdf"), null);
    assert.equal(mediaTypeOf("u/noextension", undefined), null);
  });
});
