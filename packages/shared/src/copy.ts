// Copy that is fixed (spec §5). Final lines only; drafts stay in spec.md until
// Alex and Tatiana replace them.

export const TAGLINE = "Know where you're headed, find what you're looking for.";

export const ONE_LINER = "See who's going, meet them there.";

export const PIN_IN = "Pin in — I've got a ticket";
// Free and pay-at-the-door share this one (Alex, Phase 1 M1.2; the door case added
// after M2.2). There is deliberately no third button: the button is a commitment and
// the price is a fact, a button whose words change with the price cannot be scanned
// down a list, and money inside the button makes it read like a purchase when nothing
// here is for sale. The cost goes on its own line beside it — entryLine below.
export const PIN_IN_FREE = "Pin in — I'm going";

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
  if (g.entry === "ticketed") return note ?? "";
  if (g.door_price_cents === null || g.door_price_cents === undefined) {
    return note ? `Pay at the door — ${note}` : "Pay at the door";
  }
  const cents = g.door_price_cents % 100;
  const amount = `$${Math.floor(g.door_price_cents / 100)}${cents ? `.${String(cents).padStart(2, "0")}` : ""}`;
  return note ? `${amount} at the door — ${note}` : `${amount} at the door`;
}

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
