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

describe("Changing or removing a photo after A2 (A21, Alex's walk)", () => {
  it("A07 the photo on the profile can be swapped: choose another, and Save uploads it", async () => {
    const { startEdit, editActions, editChoose, editPlan, editShows } = await import("../../packages/shared/src/a2photo.ts");
    const e = startEdit<string>("u/old.jpg");
    assert.deepEqual(editActions(e), ["choose-another", "remove"], "a photo on the profile offers no way to change it");
    const next = editChoose(e, "file://new.jpg");
    assert.equal(editShows(next), "pick");
    assert.equal(editPlan(next), "upload");
  });

  it("A08 the photo on the profile can be removed, and Save clears it", async () => {
    const { startEdit, editActions, editRemove, editPlan, editShows } = await import("../../packages/shared/src/a2photo.ts");
    const e = editRemove(startEdit<string>("u/old.jpg"));
    assert.equal(editShows(e), "nothing");
    assert.deepEqual(editActions(e), ["choose"]);
    assert.equal(editPlan(e), "clear");
  });

  it("A09 a failed upload here is never a dead end either: Remove discards it and the old photo stays", async () => {
    const { startEdit, editChoose, editRemove, editPlan, editShows, uploadFailed, editActions } = await import(
      "../../packages/shared/src/a2photo.ts"
    );
    let e = editChoose(startEdit<string>("u/old.jpg"), "file://new.jpg");
    e = { ...e, pick: uploadFailed(e.pick, "mime type text/plain is not supported") };
    assert.equal(e.pick.state, "failed");
    assert.ok(editActions(e).includes("remove"), "a failed pick offers no way out");
    e = editRemove(e);
    assert.equal(editShows(e), "current", "removing the failed pick lost the photo already there");
    assert.equal(editPlan(e), "nothing");
  });

  it("A10 with no photo yet, the only action is to choose one, and Save changes nothing", async () => {
    const { startEdit, editActions, editPlan } = await import("../../packages/shared/src/a2photo.ts");
    const e = startEdit<string>(null);
    assert.deepEqual(editActions(e), ["choose"]);
    assert.equal(editPlan(e), "nothing");
  });
});
