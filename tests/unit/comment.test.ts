// A16's comment (#10; Alex, 14 Oct 2026). The visibility is the harness's (P205–P208);
// these hold the app to the rule it sends by, and the two caps to one number.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { COMMENT_MAX, commentToSend } from "../../packages/shared/src/after.ts";
import { COMMENTS_LINK, navWithUnread } from "../../src/admin/navcount.ts";

// The database's cap, read from the migration that sets it.
function databaseCap(sql: string): number | null {
  const m = /survey_responses_comment_shape[\s\S]*?char_length\(comment\)\s*<=\s*(\d+)/.exec(sql);
  return m ? Number(m[1]) : null;
}

describe("A16's comment (#10)", () => {
  it("C10 what is sent: trimmed; nothing written, or only spaces, sends nothing", () => {
    assert.equal(commentToSend("  the spot was hard to find \n"), "the spot was hard to find");
    assert.equal(commentToSend(""), null);
    assert.equal(commentToSend(" \n\t "), null);
  });

  it("C11 the screen's limit and the database's cap are one number", () => {
    // The reader must see a cap before its answer means anything.
    assert.equal(databaseCap("constraint survey_responses_comment_shape check (comment is null or (char_length(comment) <= 42 and x))"), 42);
    assert.equal(databaseCap("nothing here"), null);
    const dir = "supabase/migrations";
    const file = readdirSync(dir).find((f) => f.endsWith("_a16_comment_box.sql"));
    assert.ok(file, "the migration that sets the cap is not found");
    assert.equal(databaseCap(readFileSync(`${dir}/${file}`, "utf8")), COMMENT_MAX, "the app and the database cap a comment differently");
  });

  it("C12 the screen sends through the shared rule and limits the box by the shared cap", () => {
    const screen = readFileSync("app/src/app/after/[slug].tsx", "utf8");
    assert.match(screen, /answer\(view\.gathering\.id, a\.value, commentToSend\(comment\)\)/, "the answer is sent without the comment, or past the shared rule");
    assert.match(screen, /maxLength=\{COMMENT_MAX\}/, "the box is not limited by the shared cap");
    const lib = readFileSync("app/src/lib/after.ts", "utf8");
    assert.match(lib, /would_have_gone: wouldHaveGone, comment \}/, "the write leaves the comment out of the row");
  });
});

describe("The unread count is on every admin page (#10, Alex's condition b)", () => {
  // The nav as ui.ts renders it, read from ui.ts itself: its NAV entries through its own
  // link template. C13 proves the template is still the one this reads.
  const ui = readFileSync("src/admin/ui.ts", "utf8");
  const navHtml = () => [...ui.matchAll(/\["(\/admin[^"]*)", "([^"]+)"\]/g)].map(([, href, label]) => `<a href="${href}">${label}</a>`).join("");

  it("C13 ui.ts still renders the nav with the template the count relies on, and lists Comments", () => {
    assert.match(ui, /const nav = NAV\.map\(\(\[href, label\]\) => `<a href="\$\{href\}">\$\{label\}<\/a>`\)\.join\(""\);/, "ui.ts renders the nav differently: the count would find nothing to replace");
    assert.ok(navHtml().includes(COMMENTS_LINK), "the nav has no Comments link for the count to go on");
  });

  it("C14 three unread on any page: the nav says so; none says 0", () => {
    assert.match(navWithUnread(navHtml(), 3), /<a href="\/admin\/comments"><strong>Comments \(3 unread\)<\/strong><\/a>/);
    assert.match(navWithUnread(navHtml(), 0), /<a href="\/admin\/comments">Comments \(0 unread\)<\/a>/);
  });

  it("C15 a count that cannot be read says so, instead of vanishing", () => {
    assert.match(navWithUnread(navHtml(), null), /Comments \(count failed\)/);
    // Every admin response goes through it: the wrapper is on the router's one return.
    const routes = readFileSync("src/admin/routes.ts", "utf8");
    assert.match(routes, /withUnreadComments\(await found\.handler\(request, ctx\), ctx\)/, "admin pages are served without the count");
  });
});
