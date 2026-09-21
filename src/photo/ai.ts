// The automated photo check (Phase 3 M3.1; decisions.md Part 5, "Automated photo
// moderation"). The prompt, the shape of the answer and what a call is expected to
// cost. The call itself is in check.ts.
//
// **Three outcomes, and the two that mean "not visible" are not the same sentence.**
// "We could not tell" sends a photo to a human; "we refused it" is a decision. They
// are kept apart in the database (`photo_status`), in the admin and here.
//
// **The check never decides age.** It can only route a photo to a human (H8). The
// 19+ rule stays with the person's attestation, their date of birth, reports and
// admin review.
//
// **The rubric was rewritten after the first real photo went through it** (Alex,
// M3.1). A professional wedding photo — him, clearly the subject, friends behind —
// was held for a human: "multiple faces in frame, though one is prominent". That is
// an ordinary photo, and **a check that holds ordinary photos turns Alex into the
// bottleneck for every new person**. Measured at the time: 23 decisions, **every
// one of them needs_review**, and not a single approval in the check's life.
//
// So the bar moved to where the harm is. **Reject is nudity, hate symbols and gore,
// and only those. needs_review is a possible minor, and only that. Everything else is
// approved** — group photos, cartoons, no face at all, a pet, a landscape. If somebody
// wants a funny picture, that is their call. Swimwear and shirtless photos are
// approved: they are not nudity.

// Sonnet 5, same model the import scores with. Vision comes free with it.
export const PHOTO_MODEL = "claude-sonnet-5";

// **Deliberately above the real cost.** An estimate that runs under is worse than one
// that runs over: it is what every aborted call is counted at, and an aborted call is
// billed while its usage never arrives (M1.3b).
//
// **Measured on the first real end-to-end run (21 Sept 2026): $0.004676 for a 1024px
// PNG, 2.9 seconds** — trigger to verdict. Two cents is four times that, which is the
// headroom a larger photo and a retry want. The labelled run confirms it across a
// real set; a number that only ever saw one image is not a measurement yet.
export const ESTIMATE_PER_PHOTO = 0.02;

// CLAUDE.md's M1.3b pattern: streamed, and aborted outright at four minutes.
export const PHOTO_CALL_MS = 4 * 60 * 1000;

// What Anthropic will accept. The bucket also allows image/heic, which it will not,
// so a HEIC upload is an operational fault the admin counts rather than a silent
// pass — and the app uploads JPEG for exactly this reason (A2, A27).
export const SUPPORTED = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export type Outcome = "approved" | "rejected" | "needs_review";

export interface Verdict {
  outcome: Outcome;
  reason: string;
}

export const PHOTO_SYSTEM = `You are checking a profile photo for Pin'd, where a photo helps a few people
recognise each other before an event. It is never browsed, never ranked, and never
shown to anyone who has not opted into meeting that person.

**Almost everything is approved.** You are not judging whether the photo is a good
profile picture, whether it shows a face, or whether it shows the right person. Those
are the person's own business. You are looking for two specific things, and nothing
else.

Answer with exactly one outcome.

**reject** — only these, and nothing like them:
- nudity or sexual content
- hate symbols or racist imagery
- gore or graphic violence

**needs_review** — only one reason: **the person in the photo might be under 19.**
Never decide this yourself; flag it and a person will look.

**approve** — everything else, without exception. That includes, and this list is
not exhaustive:
- a group photo, a wedding photo, a photo with friends behind the subject, a crowd
- several faces with no way to tell which one is the owner
- no face at all: a landscape, a pet, an object, the back of someone's head
- a cartoon, an avatar, an illustration, an AI-generated image
- a screenshot, a photo of a photo, a picture of a public figure
- a blurry, dark, distant or partly obscured face
- swimwear, a shirtless photo, a beach photo, gym clothes — **these are not nudity
  and are approved**
- anything odd, funny, unflattering or strange

**The bar for reject is harm, not quality, and the bar for needs_review is age and
nothing else.** If you find yourself reaching for needs_review because you cannot
tell who the subject is, or whether it is really them, or whether it is a real
photograph — approve it. Ambiguity about identity is not a reason to hold a photo.

Give one reason of under twenty words, written for the moderator reading the queue.`;

export const PHOTO_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["approve", "reject", "needs_review"] },
    reason: { type: "string" },
  },
  required: ["outcome", "reason"],
  additionalProperties: false,
} as const;

// The model answers in its own vocabulary; the database has its own. One place
// translates, and an answer that is neither is not a verdict.
export function parseVerdict(text: string): Verdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { outcome, reason } = parsed as { outcome?: unknown; reason?: unknown };
  const map: Record<string, Outcome> = {
    approve: "approved",
    reject: "rejected",
    needs_review: "needs_review",
  };
  if (typeof outcome !== "string" || !(outcome in map)) return null;
  return {
    outcome: map[outcome]!,
    reason: typeof reason === "string" ? reason.slice(0, 200) : "",
  };
}
