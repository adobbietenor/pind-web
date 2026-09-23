// A2's photo: its states, the buttons each state shows, and what "Continue" does.
//
// **A2 must never be a dead end** (Alex, M3.1, from the first TestFlight build). The
// upload failed, the photo stayed chosen with no way to clear it, and every tap of
// Continue retried the same failing upload — so the second screen of onboarding had
// no way forward. The photo is optional on this screen by design (Q2: required to opt
// in, never to have a profile), so **no photo state may ever block Continue**, and
// every state with a photo in it offers to remove it.
//
// Here rather than in the screen so the rule can be proved (tests/unit/a2photo.test.ts):
// the screen renders `photoActions()` and runs `savePlan()`, and the test walks a
// failed upload through both.

export type A2Photo<P = unknown> =
  | { state: "none" }
  | { state: "chosen"; picked: P }
  | { state: "failed"; picked: P; says: string };

export type PhotoAction = "choose" | "choose-another" | "remove";

export const PHOTO_UPLOAD_FAILED = (reason: string) =>
  `We could not upload your photo — ${reason}. You can choose another, or remove it and continue without one; you can add a photo later.`;

export function photoActions(photo: A2Photo): PhotoAction[] {
  return photo.state === "none" ? ["choose"] : ["choose-another", "remove"];
}

export function uploadFailed<P>(photo: A2Photo<P>, reason: string): A2Photo<P> {
  return photo.state === "none" ? photo : { state: "failed", picked: photo.picked, says: PHOTO_UPLOAD_FAILED(reason) };
}

export function removePhoto(): A2Photo<never> {
  return { state: "none" };
}

// The photo never decides whether Continue is available — only the fields do.
export function canContinue(fields: { firstName: string; oldEnough: boolean; gender: unknown }): boolean {
  return fields.firstName.trim().length > 0 && fields.oldEnough && fields.gender !== null;
}

// What Continue does, in order. A chosen or failed photo is tried; none is not.
export function savePlan(photo: A2Photo): ("upload" | "person" | "private")[] {
  return photo.state === "none" ? ["person", "private"] : ["upload", "person", "private"];
}

// ---------------------------------------------------------------------------
// Where a sign-in lands (M3.1, after the TestFlight walk).
//
// **Every sign-in, on every platform, went to A2 — and A2 showed an empty form to a
// person who already had a profile.** Signing out in the app and back in on the web
// looked exactly like a lost profile: a blank "A bit about you". The identity was
// fine; the screen never asked whether the person had been here before.
//
// A2 is finished when the private row exists (it holds the birth year and gender,
// which only A2 writes). A person row without one is the link path — pinned at A26,
// not yet through A2 — so A2 opens with their first name already in it.
// ---------------------------------------------------------------------------
export type Landing = { go: "home" } | { go: "a2"; firstName: string };

export function landingAfterSignIn(me: { firstName: string | null; hasPrivate: boolean } | null): Landing {
  if (me?.hasPrivate) return { go: "home" };
  return { go: "a2", firstName: me?.firstName ?? "" };
}

// ---------------------------------------------------------------------------
// Changing or removing a photo after A2 — A21's photo edit (Alex, M3.1 walk).
//
// **A bug, not a missing feature:** Remove and Choose another existed during A2 and
// vanished after it, so somebody with a bad photo was stuck with it — and "nothing
// waits on the check" assumes a photo is easy to swap. Same picker, same states as A2,
// plus the photo already on the profile.
//
// Remove works on what is showing: a new pick is discarded first (back to the photo
// already there), and only then does Remove take the current photo off the profile.
// ---------------------------------------------------------------------------
export interface PhotoEdit<P = unknown> {
  current: string | null; // the object name on the profile now
  removed: boolean; // the person asked to take the current one off
  pick: A2Photo<P>; // a new photo chosen here, if any
}

export function startEdit<P>(current: string | null): PhotoEdit<P> {
  return { current, removed: false, pick: { state: "none" } };
}

export function editShows(e: PhotoEdit): "pick" | "current" | "nothing" {
  if (e.pick.state !== "none") return "pick";
  return e.current && !e.removed ? "current" : "nothing";
}

export function editActions(e: PhotoEdit): PhotoAction[] {
  return editShows(e) === "nothing" ? ["choose"] : ["choose-another", "remove"];
}

export function editRemove<P>(e: PhotoEdit<P>): PhotoEdit<P> {
  if (e.pick.state !== "none") return { ...e, pick: { state: "none" } };
  return e.current ? { ...e, removed: true } : e;
}

export function editChoose<P>(e: PhotoEdit<P>, picked: P): PhotoEdit<P> {
  return { ...e, pick: { state: "chosen", picked } };
}

// What Save does. A new pick is uploaded and replaces the current one; a removal
// clears the profile's photo; anything else changes nothing.
export function editPlan(e: PhotoEdit): "upload" | "clear" | "nothing" {
  if (e.pick.state !== "none") return "upload";
  if (e.removed && e.current) return "clear";
  return "nothing";
}
