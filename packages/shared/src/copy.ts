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
