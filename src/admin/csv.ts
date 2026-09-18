// CSV that opens correctly in Excel: UTF-8 with a byte-order mark (so accented names
// survive), CRLF line endings, every field quoted.
//
// Formula injection: a first name typed by a visitor such as "=HYPERLINK(...)" would
// run as a formula in Excel. Any value starting with = + - @ tab or carriage return
// gets a leading apostrophe, which Excel shows as plain text.

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
