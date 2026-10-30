// Squads (M3.7; A9, A11, A15): named small groups, open to join. Their limits, the times
// on offer, the name's shape, the words, and what a refusal says.
//
// PROPOSED COPY (spec §5 drafts): every sentence here is a placeholder until the one copy
// pass (decisions, "Copy deferred to one pass"). The database stores none of these words,
// so the pass replaces them with no migration.
//
// **The database is the rule.** start_squad, join_squad and the eight-seat trigger refuse
// whatever this file would not offer; these copies only decide what the screens show and
// say. tests/unit/squad.test.ts holds the screens to these functions.

import { soloTimes } from "./solo.ts";

export const SQUAD_MAX_SEATS = 8; // including whoever made it (Alex, 14 Oct 2026)
export const SQUAD_NAME_MAX = 40;

// The same window as 1-on-1: from 3 h before the start to 2 h after the effective end,
// on the quarter hour, never in the past. start_squad checks it with solo_time_ok.
export function squadTimes(startsAt: string, endsAt: string | null, now: Date = new Date()): string[] {
  return soloTimes(startsAt, endsAt, now);
}

// The name's shape, as crews_squad_name_shape and start_squad hold it: trimmed, 1–40
// characters, no control characters. Null when it is fine; otherwise the sentence to show.
export function squadNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return SQUAD_COPY.nameEmpty;
  if ([...name].length > SQUAD_NAME_MAX) return SQUAD_COPY.nameTooLong;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return SQUAD_COPY.nameOneLine;
  return null;
}

export function squadSeatsLabel(seats: number): string {
  return seats >= SQUAD_MAX_SEATS ? `Full · ${SQUAD_MAX_SEATS} of ${SQUAD_MAX_SEATS}` : `${seats} of ${SQUAD_MAX_SEATS}`;
}

export const SQUAD_COPY = {
  // A15 — the list on A9.
  sectionHeading: "Squads",
  sectionHint: "Smaller groups from this crowd. Join one to start chatting.",
  startShort: "Start a squad",
  // A full squad says so in words (UI pass 1, open question 1: the cap stays).
  fullLine: "This squad is full.",
  // The count on a card (UI pass 1, 069), never "of 8".
  count: (n: number, first?: string) => (n === 1 && first ? `Just ${first} so far` : `${n} in this squad`),
  openChat: "Open chat",
  none: "No squads here yet. Start one and anyone open to meeting can join.",
  start: "Start a squad",
  join: "Join",
  full: "Full",
  womenOnly: "Women only",
  // The start sheet.
  sheetTitle: "Start a squad",
  nameLabel: "Name it",
  namePlaceholder: "Squad going to the Dog & Bear beforehand",
  nameHint: "Everyone here who's open to meeting will see it.",
  spot: "Where",
  atTheGathering: "At the gathering",
  time: "When",
  who: "Who can join",
  whoEveryone: "Anyone open to meeting",
  whoWomenOnly: "Women only",
  womenOnlyForced: "You chose women-only rooms only, so your squad is women only.",
  create: "Start it",
  nameEmpty: "Give your squad a name.",
  nameTooLong: `Keep the name to ${SQUAD_NAME_MAX} characters.`,
  nameOneLine: "Keep the name on one line.",
  // A11 — your squad.
  heading: "Your squad",
  checking: "Checking the name. It'll be listed in a moment.",
  rejected: "That name can't be listed here. Pick another and we'll put it up.",
  rename: "Use this name",
  meets: (spot: string, time: string) => `You meet at ${spot}, ${time}.`,
  members: (n: number) => (n === 1 ? "Just you so far." : `${n} of you so far.`),
  // The squad page's header line (UI pass 1, 071): "Squad · 3 of you · Leafs vs Bruins".
  headerLine: (n: number, event: string) => `Squad · ${n === 1 ? "just you" : `${n} of you`} · ${event}`,
  leave: "Leave this squad",
  leaveConfirm: "Leave this squad? You can join another one here afterwards.",
} as const;

// What a refusal from start_squad, join_squad or rename_squad says. Read from the error's
// hint first (the database names the rule), then its words. Every "that squad is gone"
// is one sentence, so a block never shows as anything else.
export function squadRefusal(refusal: unknown): string {
  const r = (refusal ?? {}) as { hint?: unknown; message?: unknown; code?: unknown };
  const hint = typeof r.hint === "string" ? r.hint : "";
  const m = typeof refusal === "string" ? refusal : String(r.message ?? "");
  const has = (code: string, words: string) => hint === code || m.includes(words);
  if (has("squad_closed", "not open any more") || hint === "squad_full") return "That squad isn't open any more.";
  if (has("squad_in_group", "already in a group") || r.code === "23505") return "You're already in a squad here. Leave it to join another.";
  if (has("squad_not_open_to_meeting", "open to meeting first")) return "Turn on meeting people here first.";
  if (has("squad_not_eligible", "not eligible")) return "Women-only squads are for women and nonbinary people who chose to be included.";
  if (has("squad_name", "1 to 40")) return SQUAD_COPY.nameTooLong;
  if (has("squad_time", "time on offer")) return "Pick one of the times on the list.";
  if (has("squad_spot", "spot")) return "Pick one of the spots on the list.";
  if (has("squad_rename", "can no longer be changed")) return "The name can't be changed now.";
  // M4.2 (29 Oct 2026): the name check can't be re-rolled, or run dry. PROPOSED copy.
  if (has("squad_name_refused_before", "not accepted before")) return "That name wasn't accepted before. Try a different one.";
  if (has("squad_rename_limit", "three renames today")) return "That's three renames today. Try again tomorrow.";
  if (has("squad_start_limit", "three squads started here")) return "You've started three squads here. Join one instead.";
  return "That didn't work. Try again in a moment.";
}
