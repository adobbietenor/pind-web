// One line about a gathering, for a reader deciding whether to go — the rules that are
// the same wherever the line comes from (M2.3c, Alex).
//
// Two jobs write these: the community liveness run, grounded in the organiser's own
// page, and the nightly import, from what the model already knows about an act or a
// team. **The prompts differ because the evidence differs; the floor under them does
// not**, and it lives here rather than twice, because a second copy of a rule is what
// this repo keeps being bitten by.
//
// The measurements that set the rules, both taken before anything was written:
//
//   community, grounded in the page   26 of 28 series described, every line specific
//   Events, from the model's own
//   knowledge, 40 real rows           32 of 40 recognised, at $0.0012 a row
//
// And the one rule Alex cared about most: **no line unless the source knew something.**
// A restatement of the title on two hundred rows is the same noise as a slogan
// repeated down the page, and a blank is better than filler.

export interface Blurb {
  what: string;
  why: string | null;
}

// **A line that goes stale is worse than no line**, and it is the one thing the first
// real pass got wrong: a library book club came back "Registration required, 1 hour
// long, **17 spots remaining**". Places remaining is deliberately not modelled anywhere
// in this product, because it is true for an hour and then it is a lie on a page we
// control (decisions Part 5) — and a model reading an organiser's page will pick it up
// every time unless something refuses it. Both prompts say so; this refuses it anyway,
// because a rule that only exists in a prompt has no floor under it.
//
// It also drops a model narrating an absence — "no format details given" — which is a
// note to us rather than a line for a reader.
const STALE = [
  /\b(spots?|spaces?|places?|tickets?|seats?)\s+(left|remaining|available)\b/i,
  /\b(remaining|left)\s+(spots?|spaces?|places?|tickets?|seats?)\b/i,
  // Deliberately NOT a bare number-and-spots rule: the first version refused
  // "Registration required (max 15 spots)", which is capacity — a fixed fact about the
  // walk, and exactly what the prompts allow. A guard that fires on a good line is the
  // failure this project keeps naming, so the number has to read as what is LEFT.
  /\bonly\b\s+\d+\s+(spots?|spaces?|places?|tickets?|seats?)\b/i,
  /\b(selling|sold)\s+(fast|out)\b/i,
  /\bthis (week|month|season)\b/i,
  /\bno\s+(format|details?|times?|information)\b[^.]*\b(given|listed|described|provided|available)\b/i,
  /\bnot\s+(specified|stated|listed|described)\b/i,
];

export const goesStale = (line: string): boolean => STALE.some((re) => re.test(line));

// The shape both prompts answer in: did the source know anything, what is it, and what
// would decide it for somebody turning up alone.
export const BLURB_FIELDS = {
  known: { type: "boolean" },
  what_it_is: { type: "string" },
  why_this_one: { type: ["string", "null"] },
} as const;

export function readBlurb(raw: unknown): Blurb | null {
  const a = raw as Record<string, unknown> | null;
  if (!a || typeof a !== "object" || a.known !== true) return null;
  const what = typeof a.what_it_is === "string" ? a.what_it_is.replace(/\s+/g, " ").trim() : "";
  // The length floor is a crude backstop under `known`: a model that says it recognised
  // the gathering and then writes "An event" has contradicted itself, and the shorter
  // answer is the one that would reach a card.
  if (what.length < 12 || what.length > 120 || goesStale(what)) return null;
  const why = typeof a.why_this_one === "string" ? a.why_this_one.replace(/\s+/g, " ").trim() : "";
  return { what, why: why && why.length <= 160 && !goesStale(why) ? why : null };
}
