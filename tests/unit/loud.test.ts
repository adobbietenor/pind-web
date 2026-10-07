// A job that cannot complete fails the run (Alex, 6 Oct 2026): the photo sweep said
// "20 the check could not complete" every hour as an ordinary success.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runJobsLoudly } from "../../src/loud.ts";

describe("Jobs that cannot complete say so (6 Oct 2026)", () => {
  it("J01 a job reporting work it could not complete fails the run — after every job has run", async () => {
    const ran: string[] = [];
    await assert.rejects(
      runJobsLoudly(
        [
          { name: "photo sweep", run: async () => (ran.push("sweep"), { message: "Looked at 20: … 20 the check could not complete.", failed: 20 }) },
          { name: "test crowd", run: async () => (ran.push("crowd"), { message: "test crowd: ahead" }) },
        ],
        () => undefined,
      ),
      /photo sweep: 20 could not complete/,
    );
    assert.deepEqual(ran, ["sweep", "crowd"], "a failing job stopped the next one from running");
  });
  it("J02 a job that throws fails the run too, named", async () => {
    await assert.rejects(runJobsLoudly([{ name: "credentials watch", run: async () => { throw new Error("no key"); } }], () => undefined), /credentials watch failed: no key/);
  });
  it("J03 nothing failed: the run succeeds and says what each job did", async () => {
    const lines: string[] = [];
    await runJobsLoudly([{ name: "photo sweep", run: async () => ({ message: "Nothing waiting.", failed: 0 }) }], (l) => lines.push(l));
    assert.deepEqual(lines, ["Nothing waiting."]);
  });
  it("J04 the hourly cron uses it — the sweep's outcome reaches the rule, not only the log", () => {
    const index = readFileSync("src/index.ts", "utf8");
    assert.match(index, /await runJobsLoudly\(\[/, "the scheduled handler no longer runs the sweep through runJobsLoudly");
    assert.match(index, /run: \(\) => sweepPhotos\(env\)/);
    const sweep = readFileSync("src/photo/sweep.ts", "utf8");
    assert.match(sweep, /failed: number;/, "the sweep's outcome no longer carries what failed");
  });
});
