// Copy that is fixed (spec §5). Final lines only; drafts stay in spec.md until
// Alex and Tatiana replace them.

export const TAGLINE = "Know where you're headed, find what you're looking for.";

export const ONE_LINER = "See who's going, meet them there.";

export const PIN_IN = "Pin in — I've got a ticket";
// For gatherings with is_free = true (Alex, Phase 1 M1.2).
export const PIN_IN_FREE = "Pin in — I'm going";

export const THRESHOLD_EXPLANATION = "Crews open when 5 people opt in.";

// Verbatim, on every crowd surface (spec W2).
export const HOUSE_RULES = [
  "Meet in public — named spots only, before the event.",
  "You see people only after they can see you.",
  "Leave any time. Block & report are one tap away.",
] as const;
