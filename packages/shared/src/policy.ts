// The privacy policy and terms: which version is live (M3.2).
//
// The pages at pind.social/privacy and /terms are DRAFTS, not reviewed by a lawyer
// (Alex, M3.2). M4.1 replaces them with lawyer-read versions and asks everybody to
// accept again — which is why A27 stores the version a person accepted, and why this
// string is the thing stored, not a date typed somewhere else.
export const POLICY_VERSION = "draft-2026-09-23";

export const POLICY_DRAFT_NOTICE =
  "This is a draft. It has not been reviewed by a lawyer, and it will be replaced before Pin'd opens to the public. If anything here is unclear or wrong, write to privacy@pind.social.";

export const PRIVACY_CONTACT = "privacy@pind.social";

// What block and report actually are TODAY, said wherever a page talks about them
// (Alex, 10 Oct 2026: "no promises on live pages that the product does not keep"). A room
// message can be reported by holding it; blocking and reporting a person or a group are
// not in the app yet. **When A24 ships, the stronger wording comes back** ("two taps from
// any person, group or message") — SC01 fails until it does, and fails if anything claims
// the taps before then.
export const SAFETY_TODAY = {
  app: "Hold any message in a room to report it. Blocking, and reporting a person or a group, are coming to the app — until then, write to safety@pind.social and a person reads it.",
  sheet: "Hold any message in a room to report it — and safety@pind.social reaches a person.",
} as const;
