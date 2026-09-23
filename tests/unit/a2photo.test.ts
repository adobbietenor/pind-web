// A2 is never a dead end (M3.1, from TestFlight).
//
// **The fault:** an upload failed, the photo stayed chosen with nothing to clear it,
// and every Continue retried the same upload — the second screen of onboarding with
// no way forward. The photo is optional on A2 (Q2), so these walk a failed upload
// through to a profile saved without one, using the same functions the screen renders
// and runs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type A2Photo,
  canContinue,
  photoActions,
  removePhoto,
  savePlan,
  uploadFailed,
} from "../../packages/shared/src/a2photo.ts";

const fields = { firstName: "Alex", oldEnough: true, gender: "man" };

describe("A2 after a failed upload", () => {
  it("A01 a failed upload can be removed, and Continue then saves without it", () => {
    let photo: A2Photo<string> = { state: "chosen", picked: "file://photo.jpg" };
    assert.deepEqual(savePlan(photo), ["upload", "person", "private"]);

    photo = uploadFailed(photo, "mime type text/plain is not supported");
    assert.equal(photo.state, "failed");
    assert.match((photo as { says: string }).says, /text\/plain/);
    assert.ok(photoActions(photo).includes("remove"), "a failed photo offers no way to remove it");
    assert.ok(canContinue(fields), "Continue was blocked by a failed photo");

    photo = removePhoto();
    assert.deepEqual(savePlan(photo), ["person", "private"], "Continue still tries to upload a removed photo");
    assert.ok(canContinue(fields));
  });

  it("A02 every state with a photo in it offers Remove; no photo offers Choose", () => {
    assert.deepEqual(photoActions({ state: "none" }), ["choose"]);
    assert.ok(photoActions({ state: "chosen", picked: 1 }).includes("remove"));
    assert.ok(photoActions({ state: "failed", picked: 1, says: "x" }).includes("remove"));
    assert.ok(photoActions({ state: "failed", picked: 1, says: "x" }).includes("choose-another"));
  });

  it("A03 the photo never decides whether Continue is available — only the fields do", () => {
    assert.equal(canContinue(fields), true);
    assert.equal(canContinue({ ...fields, firstName: "  " }), false);
    assert.equal(canContinue({ ...fields, oldEnough: false }), false, "the under-19 stop still holds");
    assert.equal(canContinue({ ...fields, gender: null }), false);
  });

  it("A04 the failure sentence says how to get out", () => {
    const failed = uploadFailed({ state: "chosen", picked: 1 }, "network down");
    assert.match((failed as { says: string }).says, /remove it and continue/);
  });
});

describe("Where a sign-in lands (M3.1, from the walk)", () => {
  it("A05 somebody who finished A2 goes home, never to a blank A2", async () => {
    const { landingAfterSignIn } = await import("../../packages/shared/src/a2photo.ts");
    assert.deepEqual(landingAfterSignIn({ firstName: "Alex", hasPrivate: true }), { go: "home" });
  });

  it("A06 a new person goes to A2; a link-path pinner goes to A2 with their name already in it", async () => {
    const { landingAfterSignIn } = await import("../../packages/shared/src/a2photo.ts");
    assert.deepEqual(landingAfterSignIn(null), { go: "a2", firstName: "" });
    assert.deepEqual(landingAfterSignIn({ firstName: "Sam", hasPrivate: false }), { go: "a2", firstName: "Sam" });
  });
});
