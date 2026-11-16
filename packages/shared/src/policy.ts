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
// (Alex, 10 Oct 2026: "no promises on live pages that the product does not keep").
// Holding someone's message in a room, a squad or a 1-on-1 plan reports THEM — never the
// message (Alex, 16 Oct 2026); blocking, and reporting from a profile or a squad's card,
// are not in the app yet. **When A24 ships, the stronger wording comes back** ("two taps from
// any person, group or message") — SC01 fails until it does, and fails if anything claims
// the taps before then.
// Since A24 shipped (16 Nov 2026): what is true now, said as strongly as it is true (SC01).
export const SAFETY_COPY = {
  app: "Report or block anyone in two taps from any person, squad or message: from their profile, their sheet, a chat, Connections or a squad. Blocking is never told to the other person. A person reviews every report within 24 hours, and safety@pind.social reaches a person.",
  sheet: "Report or block anyone in two taps from any person or message. A person reviews every report within 24 hours, and safety@pind.social reaches a person.",
} as const;
