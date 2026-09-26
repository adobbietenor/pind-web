// One profile, two ways in (Alex, M3.2 walk).
//
// A2 and A27 were two implementations of the same screen, and the women-only question
// had already drifted (yes/no on one, a tickbox on the other). Now there is one set of
// steps, drawn by shared components, and two orders:
//
//   the store path   identity → you → where
//   A27 (link path)  you → where → identity → the safety sheet
//
// "you" is first name, date of birth, gender (with women-only for nonbinary) and the
// photo; "where" is the neighbourhood and tags, with Skip ("a thinner profile is better
// than no profile" — Alex); "identity" is Apple, Google or the email code. On A27 the
// date of birth comes first, so under-19 stops before anything else is collected.
//
// This file holds the two rules both orders ask: which A27 step is next, and what a
// profile still lacks — the second is what Profile says, so a skipped step is never
// forgotten ("nudged later" was decided in M1 and never built).

import { optInMissing, type OptInFacts } from "./optin.ts";
import { TAGS_MINIMUM } from "./tags.ts";

export interface WhereFacts {
  neighbourhood: string | null;
  tagCount: number;
}

// "Where" is complete with a neighbourhood and at least the minimum of tags — what A3
// asks for. Anything less is a gap Profile names, never a gate.
export const whereComplete = (f: WhereFacts) => !!f.neighbourhood && f.tagCount >= TAGS_MINIMUM;

export type OptInStep = "you" | "where" | "identity" | "safety";

// A27's next step. The gate's own facts decide "you", "identity" and "safety"
// (optInMissing, P126); "where" sits between, asked once per visit and skippable —
// `whereDone` is true once it is complete OR the person tapped Skip on this visit.
export function nextOptInStep(f: OptInFacts & { whereDone: boolean }): OptInStep {
  const gate = optInMissing(f).step;
  if (gate === "you") return "you";
  if (!f.whereDone) return "where";
  return gate;
}

export type ProfileGap = "photo" | "neighbourhood" | "tags";

export function profileGaps(f: WhereFacts & { hasPhoto: boolean }): ProfileGap[] {
  const gaps: ProfileGap[] = [];
  if (!f.hasPhoto) gaps.push("photo");
  if (!f.neighbourhood) gaps.push("neighbourhood");
  if (f.tagCount < TAGS_MINIMUM) gaps.push("tags");
  return gaps;
}

const GAP_WORDS: Record<ProfileGap, (tagCount: number) => string> = {
  photo: () => "a photo",
  neighbourhood: () => "a neighbourhood",
  tags: (n) => (n === 0 ? `${TAGS_MINIMUM} tags` : `${TAGS_MINIMUM - n} more ${TAGS_MINIMUM - n === 1 ? "tag" : "tags"}`),
};

// What Profile says at the top when something is missing, and the label of the button
// that adds each. Null when nothing is.
export function profileGapLine(gaps: ProfileGap[], tagCount: number): string | null {
  if (!gaps.length) return null;
  const words = gaps.map((g) => GAP_WORDS[g](tagCount));
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `Your profile is still missing ${list} — it's what the people you meet go on.`;
}

export const PROFILE_GAP_ACTION: Record<ProfileGap, string> = {
  photo: "Add a photo",
  neighbourhood: "Pick your neighbourhood",
  tags: "Pick tags",
};

// The email-code step names the address it sent to (Alex, M3.2 walk: autofill put a
// different address in the field, and nothing on the screen said which one it was).
export const CODE_SENT_TO = (email: string) => `We've sent a code to ${email}. It can take a minute.`;
export const WRONG_ADDRESS = "Not that address? Use a different one";
