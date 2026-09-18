// CSV export and admin time conversion. Run with `npm run test:unit`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "../../src/admin/csv.ts";
import { formatLocal, fromLocalInput, localDate, toLocalInput } from "../../src/admin/time.ts";

describe("CSV — opens correctly in Excel", () => {
  it("C01 starts with a byte-order mark, uses CRLF, quotes every field and doubles quotes", () => {
    const out = toCsv([
      ["first_name", "note"],
      ['Zoë "Z"', "a,b"],
    ]);
    assert.ok(out.startsWith("﻿"));
    assert.equal(out, '﻿"first_name","note"\r\n"Zoë ""Z""","a,b"\r\n');
  });

  it("C02 a value that Excel would run as a formula is neutralised", () => {
    for (const evil of ["=HYPERLINK(\"x\")", "+1", "-1+1", "@SUM(A1)", "\tx", "\rx"]) {
      assert.ok(csvCell(evil).startsWith(`"'`), `${JSON.stringify(evil)} was not neutralised`);
    }
    assert.equal(csvCell("Ava"), '"Ava"');
    assert.equal(csvCell(3), '"3"');
    assert.equal(csvCell(null), '""');
  });
});

describe("Admin times — the venue's timezone, daylight saving included", () => {
  const TO = "America/Toronto";
  const VAN = "America/Vancouver";

  it("T01 Toronto summer (EDT, UTC−4) and winter (EST, UTC−5)", () => {
    assert.equal(fromLocalInput("2026-09-26T19:00", TO), "2026-09-26T23:00:00.000Z");
    assert.equal(fromLocalInput("2026-12-05T19:00", TO), "2026-12-06T00:00:00.000Z");
    assert.equal(toLocalInput("2026-09-26T23:00:00.000Z", TO), "2026-09-26T19:00");
    assert.equal(toLocalInput("2026-12-06T00:00:00.000Z", TO), "2026-12-05T19:00");
  });

  it("T02 round trip through the form, and Vancouver is 3 hours behind", () => {
    for (const v of ["2026-11-01T01:30", "2026-03-08T03:30", "2027-01-01T00:00"]) {
      assert.equal(toLocalInput(fromLocalInput(v, TO), TO), v);
    }
    assert.equal(fromLocalInput("2026-09-26T16:00", VAN), "2026-09-26T23:00:00.000Z");
  });

  it("T03 invalid input is refused, not rolled over", () => {
    assert.equal(fromLocalInput("", TO), null);
    assert.equal(fromLocalInput("2026-02-31T19:00", TO), null);
    assert.equal(fromLocalInput("tomorrow", TO), null);
  });

  it("T04 the local day, and a readable label", () => {
    assert.equal(localDate("2026-09-27T02:00:00.000Z", TO), "2026-09-26");
    assert.match(formatLocal("2026-09-26T23:00:00.000Z", TO), /Sat.*Sep.*26.*7:00/);
  });
});
