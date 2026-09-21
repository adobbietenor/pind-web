// Copy that is fixed (spec §5). Final lines only; drafts stay in spec.md until
// Alex and Tatiana replace them.

export const TAGLINE = "Know where you're headed, find what you're looking for.";

export const ONE_LINER = "See who's going, meet them there.";

// One button on every crowd page, whatever it costs to get in (Alex, after the M2.2
// walk; supersedes the two-button rule from M1.2 and the "I've got a ticket" copy
// M2.1 shipped).
//
// **A pin is a statement about you — I am going to this.** It is not a claim about
// how you got in and should not change with how you paid. Varying it made the button
// harder to recognise down a list and put a transaction where a decision belongs.
// The price sits beneath it and the registration line above it: those are facts, and
// the button is the commitment.
export const PIN_IN = "Pin in — I'm going";

// The other half of the same button (Alex, M3.1, after "Open" appeared on every crowd
// page). **The button follows what you have done at THIS gathering, never what your
// browser knows about you:**
//
//   not pinned      PIN_IN
//   already pinned  SEE_WHO
//
// **"Open" never appears on the web.** It was there because a script relabelled the
// button whenever localStorage held a Supabase session, on the assumption that a
// signed-in person has the app. Signing in once on the web flipped every crowd page
// at once — a session says somebody exists, not that they are coming to this.
export const SEE_WHO = "See who’s going";

// What it costs to walk in, said in one line. The rule that matters: **never say free
// unless it is free**, and an unknown price is "pay at the door" rather than silence —
// unknown is a different state from no cost, and the failure to avoid is somebody
// arriving at a door with no cash (Alex, after M2.2).
export function entryLine(g: {
  entry: "free" | "door" | "ticketed";
  door_price_cents?: number | null;
  entry_note?: string | null;
}): string {
  const note = g.entry_note?.trim();
  // The note is about the cost whatever the cost is: Frontrunners is a free drop-in
  // with an optional $30/yr membership, and dropping that made the page say less than
  // the truth. Found entering the community list.
  if (g.entry === "free") return note ? `Free — ${note}` : "Free";
  // "Ticketed" rather than silence. Every other state says what it costs, and a blank
  // where "Free" sits on the next card reads as free to anyone scanning — the same
  // trap as an unknown door price saying nothing (Alex asked; this is the call).
  if (g.entry === "ticketed") return note ?? "Ticketed";
  if (g.door_price_cents === null || g.door_price_cents === undefined) {
    return note ? `Pay at the door — ${note}` : "Pay at the door";
  }
  const cents = g.door_price_cents % 100;
  const amount = `$${Math.floor(g.door_price_cents / 100)}${cents ? `.${String(cents).padStart(2, "0")}` : ""}`;
  return note ? `${amount} at the door — ${note}` : `${amount} at the door`;
}

// Still the fixed §5 sentence, and **no longer the headline anywhere** (Alex, closing
// M2.3): the threshold is our mechanic, not the reader's reason. It sits under W2's
// counts as a quiet fact; W2 is headed "Who else is going?" and the pinned page will
// lead with "Find your crew" (A9/A10). A card on W1 that is short of five says nothing
// about five at all.
export const THRESHOLD_EXPLANATION = "Crews open when 5 people opt in.";

// Verbatim, on every crowd surface (spec W2). Rewritten by Alex after the M2.1
// on-device walk: the safety property each line describes is unchanged, only how it
// is said. The old set read as a safety notice on a product about making friends.
export const HOUSE_RULES = [
  "Make friends how you used to — in person.",
  "You see each other, or neither of you does.",
  "Come as you are. No pressure, no commitment.",
] as const;

// Sits under the rules on every crowd surface, styled as a fact rather than a rule.
// **Not decoration**: this is the line App Review is pointed at under Guideline 1.2,
// and it is what says meetings happen somewhere public, before the event, with staff
// and crowds around (H5, H10).
export const CREWS_MEET = "Crews meet at a spot near the venue before doors.";

// ---------------------------------------------------------------------------
// Onboarding, store path (A1–A2). Final lines are marked; the rest is in the new
// voice (an invitation, not a safety notice) and goes into the full pass with
// Tatiana before the first real crowds (spec §5, "The voice").
// ---------------------------------------------------------------------------

// **Final, and verbatim on A1 only** (spec §5): "not a dating app" appears in this
// one place in the whole product and nowhere else. Everywhere else uses crew
// language.
export const A1_POSITIONING = ["19+", "No location permission, ever", "Not a dating app"] as const;

// Why a photo, asked once, where it is asked for (spec A2).
//
// **Rewritten when the rubric was** (Alex, M3.1). "Your crew looks for a face at a
// patio table" was a promise the check no longer keeps: a photo needs no face at all
// now, and nothing verifies that it is you. Copy that says a photo proves who you are
// while the check approves cartoons is the product describing a different product.
//
// So it encourages a real photo without requiring one, and without claiming anything
// the system enforces.
export const PHOTO_WHY = "A photo of you makes it easier to find each other.";

// The three states an uploaded photo can be in before it is visible, said to its
// owner. **"We could not tell" and "we refused it" never converge** (Alex, M3.1):
// one is waiting on a person, the other is a decision, and a rejected photo leaves
// you visible without one.
export const PHOTO_STATE = {
  pending: "Checking your photo — this usually takes under a minute.",
  needs_review: "We could not tell from this one, so someone is taking a look. You are on the list either way.",
  rejected: "That photo is not one we can use. You are still on the list without one — add a different photo any time.",
  approved: "Your photo is live.",
} as const;

// Gender, asked once, shown to nobody — not even to you (D1, spec A2). The line
// exists because a protected attribute asked for without a reason reads as nosy.
export const GENDER_WHY = "Asked once, for women-only crews. It never appears on your profile.";

// The 19+ stop is hard and has no soft fail (H8). The line is plain rather than
// apologetic: there is nothing to negotiate and nothing to try again.
export const UNDER_19 = "Pin'd is 19+. You will not be able to continue.";

// The photo, asked at A2 and **required only at A27**, when somebody opts in to
// meeting people at a gathering (Q2, revised). It is never required to pin, and never
// required to have a profile — so A2 asks and does not block, and these two lines are
// what make that legible instead of ambiguous.
//
// The label was "A photo of your face" (Alex, M3.1: "something warmer that still
// makes clear it needs to be them"). It is how a stranger knows who they are looking
// for, so it is not decoration — and it is not a security requirement either.
// It was "A photo, so people know it’s you", which overclaimed for the same reason
// PHOTO_WHY did: nothing checks that it is you.
export const PHOTO_LABEL = "A photo";

// When it is actually needed. Said plainly, because "optional" on its own invites
// somebody to skip it and then hit a wall nobody warned them about.
export const PHOTO_WHEN = "Add one now or later — you’ll need one before you can meet up with anyone.";

// A1's own header, on the screen where the first name is asked.
export const A2_HEADING = "A bit about you";
