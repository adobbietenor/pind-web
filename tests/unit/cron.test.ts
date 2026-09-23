// Which job each cron runs (M3.1).
//
// The scheduled handler used to send any cron it did not recognise to the nightly
// import, so the hourly photo sweep was one typo from running the import every hour.
// C03 is that refusal, made to fire. C04 compares the two places the crons are written
// — wrangler.jsonc and src/cron.ts — normalised the same way on both sides, so a
// trigger with no job (or a job with no trigger) fails here instead of in production.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CRONS, IMPORT_CRON, jobsFor, LIVENESS_CRON, PHOTO_SWEEP_CRON } from "../../src/cron.ts";

const at = (hourUtc: number) => Date.UTC(2026, 8, 23, hourUtc, 0, 0);

describe("Which job a cron runs", () => {
  it("C01 the import runs at 08:00 and only then", () => {
    assert.deepEqual(jobsFor(IMPORT_CRON, at(8)), ["import"]);
    for (const h of [0, 9, 10, 13, 23]) assert.ok(!jobsFor(PHOTO_SWEEP_CRON, at(h)).includes("import"), `hour ${h}`);
    assert.deepEqual(jobsFor(LIVENESS_CRON, at(13)), ["liveness"]);
  });

  it("C02 the photo sweep runs every hour; the credential watch rides only its 09:00 run", () => {
    for (let h = 0; h < 24; h++) {
      const jobs = jobsFor(PHOTO_SWEEP_CRON, at(h));
      assert.ok(jobs.includes("photo-sweep"), `no sweep at ${h}:00`);
      assert.equal(jobs.includes("credentials"), h === 9, `credential watch at ${h}:00`);
    }
  });

  it("C03 a cron nobody recognises runs NOTHING — never the import", () => {
    for (const unknown of ["0 9 * * *", "0 */1 * * *", " 0 * * * *", "", "*/5 * * * *"]) {
      assert.deepEqual(jobsFor(unknown, at(8)), [], `"${unknown}" ran something`);
    }
  });

  it("C04 wrangler.jsonc's triggers are exactly the crons the code routes", () => {
    const config = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");
    const line = config.match(/"crons"\s*:\s*\[([^\]]*)\]/);
    assert.ok(line, "no crons in wrangler.jsonc");
    const norm = (c: string) => c.trim().replace(/\s+/g, " ");
    const configured = [...line[1]!.matchAll(/"([^"]*)"/g)].map((m) => norm(m[1]!)).sort();
    assert.deepEqual(configured, [...CRONS].map(norm).sort());
  });
});
