// A24 (report and block), the admin's ban and A18 #10 (Alex, 16 Nov 2026): the parts the
// policy harness cannot reach — the report email's words, the suspended sentence, and the
// wiring that makes a report reach the admin. The database's halves are P313–P319.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { reportEmail } from "../../src/notify/report-email.ts";
import { signInSays } from "../../packages/shared/src/signin.ts";
import { A24_COPY } from "../../packages/shared/src/a24.ts";

const read = (p: string) => readFileSync(p, "utf8");

describe("A report reaches the admin (16 Nov 2026)", () => {
  it("R01 the email names the reason and who, links to their card, and never carries words from a message", () => {
    const mail = reportEmail(
      { report_id: "r", reason: "uncomfortable", target_kind: "person", person_id: "p1", first_name: "Sam", crew_name: null, hidden: true, reports_on_them: 2, created_at: "2026-11-16T22:01:00Z" },
      "https://pind.social",
    );
    assert.match(mail.subject, /Made me uncomfortable/);
    assert.match(mail.subject, /Sam/);
    assert.match(mail.text, /https:\/\/pind\.social\/admin\/reports#person-p1/, "no link to the person's card");
    assert.match(mail.text, /hidden now/);
    const squad = reportEmail({ report_id: "r", reason: "spam", target_kind: "crew", person_id: null, first_name: null, crew_name: "Section 314", hidden: null, reports_on_them: 0, created_at: "2026-11-16T22:01:00Z" }, "https://pind.social");
    assert.match(squad.subject, /the squad "Section 314"/);
    assert.match(squad.text, /\/admin\/reports$/m);
  });

  it("R02 the wiring: the route, the card's anchor, the trigger asks the one harness rule, and a missing ADMIN_EMAILS says so", () => {
    assert.match(read("src/router.ts"), /"POST \/hooks\/report": reportWebhook,/);
    assert.match(read("src/admin/moderation.ts"), /<tr id=\\"person-\$\{e\(personId\)\}\\">|<tr id="person-\$\{e\(personId\)\}">/, "the email's link lands on no card");
    const sql = readdirSync("supabase/migrations").filter((f) => f.includes("a18_a24")).map((f) => read(`supabase/migrations/${f}`)).join("\n");
    assert.match(sql, /create function private\.report_alert_webhook[\s\S]*if not private\.report_alert_wanted\(new\.reporter_id, v_person\) then/, "the trigger does not ask the harness rule P318 proves");
    assert.match(sql, /create trigger reports_alert_admin after insert on public\.reports/);
    assert.match(read("src/notify/report-alert.ts"), /ADMIN_EMAILS is not set/);
  });

  it("R03 ban and unban lock and unlock the sign-in after the database's half, and each is on the card", () => {
    const mod = read("src/admin/moderation.ts");
    assert.match(mod, /banAction\("admin_ban_person", BAN_FOREVER,/);
    assert.match(mod, /banAction\("admin_unban_person", "none",/);
    assert.match(mod, /auth\.admin\.updateUserById\(String\(authId\), \{ ban_duration: duration \}\)/);
    assert.match(mod, /actionForm\(personId, "ban",/);
    assert.match(read("src/admin/routes.ts"), /\["POST \/admin\/people\/:id\/ban", m\.banPerson\]/);
  });
});

describe("A banned person is told plainly (16 Nov 2026)", () => {
  it("R04 'User is banned' reads as suspended at every sign-in step, never a generic failure", () => {
    for (const step of ["send", "verify", "oauth"] as const) assert.equal(signInSays(step, "User is banned"), A24_COPY.suspended);
    assert.notEqual(signInSays("verify", "something else"), A24_COPY.suspended, "everything reads as suspended");
    assert.match(read("app/src/lib/errors.ts"), /if \(isBanned\(err\)\) return \{ says: A24_COPY\.suspended \};/);
  });
});

describe("A24 is two taps from any person, squad or message (H9)", () => {
  it("R05 the ⋯ is on the profile, the person sheet, the chat, Connections, a squad's people and a squad's card; long-press offers Block", () => {
    for (const f of ["app/src/app/person/[id].tsx", "app/src/components/PersonSheet.tsx", "app/src/app/chat/[id].tsx", "app/src/app/(tabs)/connections.tsx", "app/src/app/group/[id].tsx", "app/src/components/SquadSection.tsx"]) {
      const src = read(f);
      assert.match(src, /<MoreButton\b/, `${f} has no ⋯`);
      assert.match(src, /<ReportBlockSheet\b/, `${f} has no A24 sheet`);
    }
    assert.match(read("app/src/app/person/[id].tsx"), /const A24_EXISTS = true;/);
    const ms = read("app/src/components/MessageSheet.tsx");
    assert.match(ms, /label=\{A24_COPY\.block\(authorName\)\} onPress=\{onBlock\}/, "long-press offers no Block");
    for (const f of ["app/src/app/room/[id].tsx", "app/src/app/group/[id].tsx", "app/src/app/chat/[id].tsx"]) assert.match(read(f), /onBlock=\{/, `${f}'s long-press cannot block`);
    // Settings → Blocked people, with the words before an unblock.
    assert.match(read("app/src/app/settings.tsx"), /router\.push\("\/blocked"\)/);
    assert.match(read("app/src/app/blocked.tsx"), /<Body>\{A24_COPY\.unblockWhat\}<\/Body>/);
  });
});
