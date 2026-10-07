// Delivering notifications (M3.3): where each goes, the signed stop link, the email.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { channelFor, emailFor, KINDS, stopToken, stopTokenValid, stopUrl } from "../../src/notify/rules.ts";
import { jobsFor, NOTIFY_CRON } from "../../src/cron.ts";
import { NOTIFICATIONS, pushWasTaken } from "../../packages/shared/src/notify.ts";
import { Constants, type Database } from "../../packages/shared/src/database.types.ts";

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

describe("The six kinds, one list", () => {
  it("N08 the app's switches, the Worker's kinds, the database's enum and its switch columns are the same seven", () => {
    const db = [...Constants.public.Enums.notification_kind].sort();
    assert.deepEqual(NOTIFICATIONS.map((n) => n.kind).sort(), db, "Settings' switches differ from the database's kinds");
    assert.deepEqual([...KINDS].sort(), db, "the Worker's kinds differ from the database's");
    assert.equal(db.length, 7);
    // The stop link and Settings write the column named by the kind (admin_switch_off), so
    // every kind must be a column. M3.3 named one `invites` for the kind `invite`.
    const columns: (keyof Database["public"]["Tables"]["notification_settings"]["Row"])[] = ["digest", "room_open", "plan_status", "day_of", "next_morning", "room_activity", "invite"];
    assert.deepEqual([...columns].sort(), db, "a kind has no switch column of its own name");
  });

  // Five became seven by editing A18's heading, with no entry weighing either against the
  // ban on bait (Alex, 6 Oct 2026). A new kind is an enum value, so it cannot arrive
  // without A18 naming it and saying why it is not bait.
  it("N09 spec A18 names every kind in the database, one numbered line each, and each says why it is not bait", () => {
    const spec = readFileSync("spec.md", "utf8").replace(/\r\n/g, "\n");
    const a18 = spec.slice(spec.indexOf("### A18 "), spec.indexOf("### A19 "));
    assert.ok(a18.length > 200, "could not find spec A18");
    const items = a18.split("\n").filter((l) => /^\d+\. \*\*/.test(l)).map((l, i) => ({ line: l, at: a18.indexOf(l), i }));
    const db = [...Constants.public.Enums.notification_kind];
    assert.equal(items.length, db.length, `A18 lists ${items.length} moments; the database has ${db.length} kinds`);
    for (const kind of db) {
      const item = items.find((it) => it.line.includes(`(\`${kind}\`)`));
      assert.ok(item, `the database's kind "${kind}" is not named in A18`);
      const next = items.find((it) => it.i === item.i + 1);
      const body = a18.slice(item.at, next ? next.at : a18.indexOf("**Nothing else.**"));
      assert.match(body, /\*Not bait/, `A18's "${kind}" has no reason it is not bait`);
    }
  });
});

describe("A phone's notifications taken by another account (L8)", () => {
  const T = "ExponentPushToken[abc]";
  it("N10 a phone that registered for me and is no longer mine is 'taken' — never silently taken back", () => {
    assert.equal(pushWasTaken({ local: { token: T, userId: "me" }, token: T, userId: "me", serverHasIt: false }), true);
  });
  it("N11 not taken: still mine; never registered here; a phone that changed hands; a new token", () => {
    assert.equal(pushWasTaken({ local: { token: T, userId: "me" }, token: T, userId: "me", serverHasIt: true }), false);
    assert.equal(pushWasTaken({ local: null, token: T, userId: "me", serverHasIt: false }), false);
    assert.equal(pushWasTaken({ local: { token: T, userId: "someone-else" }, token: T, userId: "me", serverHasIt: false }), false, "a phone handed over to me is not 'taken' from me");
    assert.equal(pushWasTaken({ local: { token: "ExponentPushToken[old]", userId: "me" }, token: T, userId: "me", serverHasIt: false }), false);
  });
  it("N12 the app's start uses the rule and asks — it does not re-register over a taken phone", () => {
    const push = readFileSync("app/src/lib/push.ts", "utf8");
    const layout = readFileSync("app/src/app/_layout.tsx", "utf8");
    assert.match(push, /pushWasTaken\(/, "push.ts decides 'taken' some other way");
    assert.match(push, /return "taken";/);
    assert.ok(push.indexOf('return "taken";') < push.indexOf("await register();\n    return \"ok\";".replace(/\n/g, push.includes("\r\n") ? "\r\n" : "\n")), "push.ts registers before it checks");
    assert.match(layout, /kept !== "taken"/, "the app's start no longer says anything when its phone was taken");
    assert.match(layout, /PUSH_TAKEN\.line/);
  });
});
