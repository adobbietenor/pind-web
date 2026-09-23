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
