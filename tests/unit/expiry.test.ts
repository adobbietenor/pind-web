// Credentials that lapse on a date (Phase 3 M3.1). The Apple client secret is the
// first: six months, and when it goes the WEB breaks while native iOS keeps working,
// so the half that still works hides the half that stopped.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appleSecretExpiry, daysUntil, expiringCredentials, WARN_DAYS, worthAnAlert } from "../../src/ops/expiry.ts";

const on = (day: string) => new Date(`${day}T12:00:00Z`);

describe("How long is left", () => {
  it("E01 counts whole days from today, not hours, so a date is either today or it is not", () => {
    assert.equal(daysUntil("2027-03-23", on("2026-09-21")), 183); // six months, Apple's cap
    assert.equal(daysUntil("2026-09-22", on("2026-09-21")), 1);
    // Today is zero, not "expired": a secret lapses at the end of its day.
    assert.equal(daysUntil("2026-09-21", on("2026-09-21")), 0);
    assert.equal(daysUntil("2026-09-20", on("2026-09-21")), -1);
  });

  it("E02 a value that is not a date is unreadable, which is not the same as absent", () => {
    assert.equal(daysUntil("soon"), null);
    assert.equal(daysUntil("23/03/2027"), null);
    assert.equal(appleSecretExpiry("23/03/2027").state, "unreadable");
    assert.equal(appleSecretExpiry(undefined).state, "unrecorded");
    assert.equal(appleSecretExpiry("   ").state, "unrecorded");
  });
});

describe("The four states, and the one people forget", () => {
  it("E03 plenty of time is quiet", () => {
    const x = appleSecretExpiry("2027-03-23", on("2026-09-21"));
    assert.equal(x.state, "ok");
    assert.match(x.says, /Good until 2027-03-23/);
  });

  it("E04 the warning starts six weeks out, and the boundary is inclusive", () => {
    assert.equal(appleSecretExpiry("2026-11-02", on("2026-09-21")).state, "soon", `${WARN_DAYS} days should warn`);
    assert.equal(appleSecretExpiry("2026-11-03", on("2026-09-21")).state, "ok");
  });

  it("E05 lapsed says the app is still fine, because that is why nobody reported it", () => {
    const x = appleSecretExpiry("2026-09-14", on("2026-09-21"));
    assert.equal(x.state, "lapsed");
    assert.equal(x.daysLeft, -7);
    assert.match(x.says, /the app is still fine/);
  });

  it("E06 unrecorded is a state, not an absence — nobody knows is not fine", () => {
    // The house rule: unset is a different state from broken. A date nobody wrote
    // down means the warning itself does not exist, so it is worth an alert too.
    const x = appleSecretExpiry(undefined);
    assert.equal(x.state, "unrecorded");
    assert.match(x.says, /nobody knows/);
    assert.equal(worthAnAlert([x]).length, 1);
  });
});

describe("What reaches out", () => {
  it("E07 only the states somebody must act on, so the channel is not cried wolf at", () => {
    const quiet = expiringCredentials({ APPLE_SECRET_EXPIRES: "2027-03-23" }, on("2026-09-21"));
    assert.equal(worthAnAlert(quiet).length, 0);
    for (const value of ["2026-10-01", "2026-09-01", undefined, "nonsense"]) {
      const list = expiringCredentials({ APPLE_SECRET_EXPIRES: value }, on("2026-09-21"));
      assert.equal(worthAnAlert(list).length, 1, `${value} should be worth an alert`);
    }
  });
});
