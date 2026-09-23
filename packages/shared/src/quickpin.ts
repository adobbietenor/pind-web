// A26 — the quick pin: its fields, its words and its validation, in ONE place (M3.2).
//
// **A26 is the one screen built twice** (Alex, M3.2): the Worker renders it for the
// web, where a stranger from Reddit meets it and it has W2's budget; the app renders
// it for someone who has the app. Two screens asking the same questions drift unless
// nothing about the questions lives in either of them — so the field names, every
// label and sentence, and the rule for what counts as a valid answer are here, and
// `tests/unit/quickpin.test.ts` fails if either screen writes its own (Q03, Q04).
//
// Spec A26: first name; who's coming — alone / +1 / +2 / a group (enter a number) →
// `party_total` (Q1); "I'd like to meet up with others going" (unticked); "I'm 19 or
// older" (H8). The database holds the same limits (first name 1–40 trimmed, party
// 1–10), and the 19+ record is required for the pin itself (P100).

import { PIN_IN } from "./copy.ts";

// The names a form posts and a screen keys its state by. The Worker's HTML form and the
// app's state both use these; a literal "first_name" in either screen fails Q04.
export const QUICKPIN_FIELDS = {
  firstName: "first_name",
  party: "party",
  groupSize: "group_size",
  meetUp: "meet_up",
  nineteen: "nineteen",
} as const;

export type QuickPinField = (typeof QUICKPIN_FIELDS)[keyof typeof QUICKPIN_FIELDS];

// Who's coming (Q1: a +1 is a body in the count, never a person on a list).
export const PARTY_CHOICES = [
  { value: "1", label: "Just me" },
  { value: "2", label: "Me +1" },
  { value: "3", label: "Me +2" },
  { value: "group", label: "A group" },
] as const;

export const PARTY_MAX = 10;

export const QUICKPIN_COPY = {
  heading: "Pin in",
  firstName: "Your first name",
  firstNameHint: "It's what people going will see if you both want to meet.",
  party: "Who's coming?",
  groupSize: "How many of you, you included?",
  meetUp: "I'd like to meet up with others going",
  meetUpHint: "Leave it unticked to just be counted. You can change it any time.",
  nineteen: "I'm 19 or older",
  submit: PIN_IN,
  // The answers that do not pass, each said beside the field it is about.
  needName: "Your first name, please.",
  nameTooLong: "That's longer than a first name — 40 characters at most.",
  needParty: "Say who's coming.",
  needGroupSize: `How many of you? A number from 2 to ${PARTY_MAX}.`,
  needNineteen: "Pin'd is 19+. Tick the box if you're 19 or older.",
  // After the pin: the confirmation, the count and progress, one primary button, then
  // change or remove, share, add to calendar (spec A26, as changed in M3.2).
  // "You're in", not "You're pinned": plain English for someone who has never used
  // this (Alex, M3.2).
  pinned: "You're in",
  alreadyPinned: "You were already in — we've updated it",
  share: "Share this crowd",
  addToCalendar: "Add to calendar",
  editOrRemove: "Change or remove my pin",
  // The one primary button after the pin (Alex, M3.2): into the app, which the page has
  // already started loading. Ticked "meet up" goes to the details; otherwise the list.
  nextDetails: "Next: a few details so people can find you",
  // The no-JavaScript case (Alex, M3.2): never a silent dead end.
  noScript:
    "You're in. To change or remove it later, open this page again in this browser with JavaScript switched on — your pin is kept for you here.",
  closed: "Pinning has closed — this one has finished.",
  // Editing a pin already there (the app's A26; the Worker's page links to it).
  save: "Save my pin",
  remove: "Remove my pin",
  removed: "Your pin is removed. The count has gone down by your party.",
  closedCanRemove: "This one has finished, so your pin can't be changed — but you can still remove it.",
  tryAgain: "That didn't go through. Try again in a moment.",
} as const;

// The count and the threshold with progress (Alex, M3.2). **Not "You're #3 pinned"**:
// it read as a rank, and it was wrong when you brought people — the number counts
// bodies, your friends included. "Going" is the plain word for that number, the one
// W2's box uses; "open to meeting" is the only word for the second.
export const quickPinPlace = (going: number) => `${going} going so far`;
export const quickPinProgress = (open: number, threshold: number) =>
  open >= threshold ? "Crews are forming" : `${open} of ${threshold} open to meeting · ${threshold - open} to go`;

export type QuickPinInput = Partial<Record<QuickPinField, string | undefined>>;

export type QuickPinResult =
  | { ok: true; value: { firstName: string; partyTotal: number; openToMeeting: boolean } }
  | { ok: false; field: QuickPinField; says: string };

// A checkbox posts "on" (HTML) or is true in the app's state as "on"; absent is off.
const ticked = (v: string | undefined) => v === "on" || v === "true" || v === "1";

export function readQuickPin(input: QuickPinInput): QuickPinResult {
  const F = QUICKPIN_FIELDS;
  const name = (input[F.firstName] ?? "").trim();
  if (!name) return { ok: false, field: F.firstName, says: QUICKPIN_COPY.needName };
  if (name.length > 40) return { ok: false, field: F.firstName, says: QUICKPIN_COPY.nameTooLong };

  const party = input[F.party];
  let partyTotal: number;
  if (party === "group") {
    const n = Number((input[F.groupSize] ?? "").trim());
    if (!Number.isInteger(n) || n < 2 || n > PARTY_MAX) {
      return { ok: false, field: F.groupSize, says: QUICKPIN_COPY.needGroupSize };
    }
    partyTotal = n;
  } else if (party === "1" || party === "2" || party === "3") {
    partyTotal = Number(party);
  } else {
    return { ok: false, field: F.party, says: QUICKPIN_COPY.needParty };
  }

  if (!ticked(input[F.nineteen])) return { ok: false, field: F.nineteen, says: QUICKPIN_COPY.needNineteen };

  return { ok: true, value: { firstName: name, partyTotal, openToMeeting: ticked(input[F.meetUp]) } };
}

// The key supabase-js stores a session under, derived the way supabase-js derives it
// (`sb-<project ref>-auth-token`). The Worker's page reads only WHETHER a session
// exists under it — someone already signed in is sent to the app's A26 to pin as
// themselves. Q02 compares it with a real client's; supabase-js upgrades are
// deliberate and re-checked (CLAUDE.md).
export function supabaseStorageKey(supabaseUrl: string): string {
  // The hostname without `URL`, which the shared package's own config does not assume.
  const host = supabaseUrl.replace(/^[a-z]+:\/\//i, "").split(/[/:?#]/)[0] ?? "";
  return `sb-${host.split(".")[0]}-auth-token`;
}

// ---------------------------------------------------------------------------
// The write, once: person → 19+ record → pin (or update the pin already there).
//
// Both A26s run this with a client signed in AS the visitor — the Worker with the
// visitor's own token and the publishable key, the app with its session — so RLS
// decides every step exactly the same way (H11). It was about to be written twice;
// Q04 now fails if either screen writes its own.
// ---------------------------------------------------------------------------

// The slice of a supabase-js client this needs, so the shared package does not depend
// on supabase-js itself.
type Result<T> = PromiseLike<{ data: T; error: { message?: string } | null }>;
interface Query {
  select(columns: string): Query;
  insert(row: Record<string, unknown>): Query;
  update(row: Record<string, unknown>): Query;
  upsert(row: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates: boolean }): Query;
  eq(column: string, value: string): Query;
  maybeSingle(): Result<unknown>;
  single(): Result<unknown>;
  then: Result<unknown>["then"];
}
export interface QuickPinDb {
  from(table: string): Query;
}

async function step<T>(q: PromiseLike<{ data: T; error: { message?: string } | null }>, what: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(`${what}: ${error.message ?? "failed"}`), { cause: error });
  return data;
}

export async function writeQuickPin(
  db: QuickPinDb,
  authUserId: string,
  gatheringId: string,
  value: { firstName: string; partyTotal: number; openToMeeting: boolean },
): Promise<{ personId: string; already: boolean }> {
  const mine = (await step(db.from("people").select("id").eq("auth_user_id", authUserId).maybeSingle(), "read my person")) as {
    id: string;
  } | null;
  let personId = mine?.id;
  if (personId) {
    await step(db.from("people").update({ first_name: value.firstName }).eq("id", personId), "update my name");
  } else {
    const made = (await step(
      db.from("people").insert({ auth_user_id: authUserId, first_name: value.firstName }).select("id").single(),
      "make my person",
    )) as { id: string };
    personId = made.id;
  }
  // The 19+ tick, once (P100: no pin without it). ON CONFLICT DO NOTHING needs only the
  // insert grant.
  await step(
    db.from("age_attestations").upsert({ person_id: personId, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }),
    "record 19+",
  );
  const pin = { party_total: value.partyTotal, open_to_meeting: value.openToMeeting };
  const existing = (await step(
    db.from("pins").select("id").eq("person_id", personId).eq("gathering_id", gatheringId).maybeSingle(),
    "read my pin",
  )) as { id: string } | null;
  if (existing) {
    await step(db.from("pins").update(pin).eq("id", existing.id), "update my pin");
    return { personId, already: true };
  }
  await step(db.from("pins").insert({ gathering_id: gatheringId, person_id: personId, ...pin }), "pin");
  return { personId, already: false };
}
