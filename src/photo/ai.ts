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

// Sonnet 5, same model the import scores with. Vision comes free with it.
export const PHOTO_MODEL = "claude-sonnet-5";

// **Before the labelled run this is a guess, and it is deliberately high.** An
// estimate that runs under the real cost is worse than one that runs over: it is
// counted for every aborted call, and an aborted call is billed while its usage never
// arrives (M1.3b). A 1024px photo is roughly 1.6k input tokens and the answer is
// ~60 output, which at Sonnet 5's prices is about $0.004. Two cents leaves room for a
// large image and a retry, and the eval run replaces it with a measured number.
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

export const PHOTO_SYSTEM = `You are checking a profile photo for Pin'd, where a photo has one job: to let a few
strangers recognise one person at a patio table before an event. It is never browsed,
never ranked, and never shown to anyone who has not opted into meeting that person.

Answer with exactly one outcome.

**approve** — one clearly visible human face, unobstructed enough to recognise the
person by, and plainly a photograph of a real person.

**reject** — the image is clearly inappropriate as a profile photo: sexual or nude
content, graphic violence, hate symbols, or abuse.

**needs_review** — anything else, and anything you are not sure about. Specifically:
- the person could be under 19. Never decide this yourself: route it here.
- not a photograph of a real person — a cartoon, an illustration, a render, an
  obviously AI-generated face, a screenshot of a screen.
- it may be someone else's photo — a recognisable public figure, stock photography,
  a photo of a photo.
- more than one face, so which person this is is ambiguous.
- no face at all, or a face too small, dark, blurred or obscured to recognise.
- borderline dress or context that you would want a person to look at.

**Lean to needs_review over both of the others.** A wrong approve puts an unchecked
image in front of strangers. A wrong reject takes someone's photo away and they never
find out why. A needs_review only asks a person to look, which costs a minute.

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
