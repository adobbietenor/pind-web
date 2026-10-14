// M3.4 — 1-on-1 (A28, A29). The visibility is the harness's (P209–P215); these hold the
// admin to the way back (Alex, 14 Oct 2026: "a single bad report must not be a one-way
// door"; solo does not ship until it exists — decisions, "M3.4: who can see whom in 1-on-1").
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("The way back into 1-on-1 is wired, end to end (M3.4)", () => {
  const routes = readFileSync("src/admin/routes.ts", "utf8");
  const moderation = readFileSync("src/admin/moderation.ts", "utf8");

  it("SO01 the route exists and calls the database's return, not anything else", () => {
    assert.match(routes, /\["POST \/admin\/people\/:id\/return-to-solo", m\.returnToSolo\]/, "no route returns someone to 1-on-1");
    assert.match(moderation, /export const returnToSolo = personAction\("admin_return_to_solo",/, "the handler does not call admin_return_to_solo");
  });

  it("SO02 the report queue finds everyone out of 1-on-1 and offers the button on their card", () => {
    // The pattern must see a real read first, or "no match" would pass by finding nothing.
    assert.match(moderation, /\.eq\("hidden_from_solo", true\)/, "the queue never looks for people out of 1-on-1");
    assert.match(moderation, /actionForm\(personId, "return-to-solo", "Return to 1-on-1"/, "the card offers no way back");
    assert.match(moderation, /Out of 1-on-1, nothing else open/, "someone out of 1-on-1 with no open report would be on no list at all");
  });
});
