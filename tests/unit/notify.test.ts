// Delivering notifications (M3.3): where each goes, the signed stop link, the email.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { channelFor, emailFor, KINDS, stopToken, stopTokenValid, stopUrl } from "../../src/notify/rules.ts";
import { jobsFor, NOTIFY_CRON } from "../../src/cron.ts";

const SECRET = "test-secret-not-real";

describe("Where a notification goes", () => {
  const can = { push: true, email: true };
  it("N01 a phone gets push; no phone gets email; neither gets nothing — recorded, not retried", () => {
    assert.equal(channelFor({ tokens: ["ExponentPushToken[a]"], email: "a@example.com" }, can), "push");
    assert.equal(channelFor({ tokens: [], email: "a@example.com" }, can), "email");
    assert.equal(channelFor({ tokens: [], email: null }, can), "none");
    assert.equal(channelFor({ tokens: [], email: "   " }, can), "none", "a blank address is no address");
  });

  it("N02 without the push credential a person with a phone is emailed instead — never a push that cannot go", () => {
    assert.equal(channelFor({ tokens: ["ExponentPushToken[a]"], email: "a@example.com" }, { push: false, email: true }), "email");
    assert.equal(channelFor({ tokens: ["ExponentPushToken[a]"], email: null }, { push: false, email: true }), "none");
  });

  it("N03 the every-minute cron delivers, and only that", () => {
    assert.deepEqual(jobsFor(NOTIFY_CRON, Date.now()), ["notify"]);
  });
});

describe("The one-tap stop link", () => {
  const person = "5f3c2b1a-0000-4000-8000-000000000001";
  it("N04 the link we sent works, for that person and that kind — and a pair differing only in whitespace still matches", async () => {
    const t = await stopToken(SECRET, person, "room_activity");
    assert.equal(await stopTokenValid(SECRET, person, "room_activity", t), true);
    assert.equal(await stopTokenValid(SECRET, ` ${person} `, "room_activity", ` ${t}\n`), true, "normalised differently on the two sides");
    assert.equal(await stopTokenValid(` ${SECRET}\n`, person, "room_activity", t), true, "a secret with a newline round it signed differently");
  });

  it("N05 it refuses a tampered token, another person, another kind and an unknown kind", async () => {
    const t = await stopToken(SECRET, person, "room_activity");
    assert.equal(await stopTokenValid(SECRET, person, "room_activity", t.slice(0, -1) + (t.endsWith("A") ? "B" : "A")), false);
    assert.equal(await stopTokenValid(SECRET, "5f3c2b1a-0000-4000-8000-000000000002", "room_activity", t), false);
    assert.equal(await stopTokenValid(SECRET, person, "room_open", t), false);
    assert.equal(await stopTokenValid(SECRET, person, "everything", t), false);
    assert.equal(await stopTokenValid("another-secret", person, "room_activity", t), false);
  });

  it("N06 the email carries the way in and the way out", async () => {
    const stop = await stopUrl(SECRET, person, "room_activity");
    const mail = emailFor({ title: "Leafs vs Bruins", body: "New messages in the Leafs vs Bruins room", path: "/crowd/leafs-bruins-oct-3", kind: "room_activity" }, stop);
    assert.equal(mail.subject, "New messages in the Leafs vs Bruins room");
    assert.match(mail.text, /https:\/\/pind\.social\/crowd\/leafs-bruins-oct-3/);
    assert.ok(mail.text.includes(stop), "the email has no way to stop them");
    assert.match(stop, /^https:\/\/pind\.social\/account\/stop\?p=.+&k=room_activity&t=[A-Za-z0-9_-]+$/);
  });

  it("N07 every kind has words for its stop line", () => {
    for (const k of KINDS) assert.ok(emailFor({ title: "x", body: "y", path: "/", kind: k }, "z").text.includes("Stop "));
  });
});
