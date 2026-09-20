// Copy that is fixed (spec §5). Final lines only; drafts stay in spec.md until
// Alex and Tatiana replace them.

export const TAGLINE = "Know where you're headed, find what you're looking for.";

export const ONE_LINER = "See who's going, meet them there.";

export const PIN_IN = "Pin in — I've got a ticket";
// For gatherings with is_free = true (Alex, Phase 1 M1.2).
export const PIN_IN_FREE = "Pin in — I'm going";

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
