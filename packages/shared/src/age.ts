// The 19+ rule's arithmetic (H8, spec A2/A27).
//
// **It lives here, and has tests, because it is a hard rule rather than a form
// detail.** An off-by-one on the birthday edge does not look like a bug — it looks
// like a profile — and the failure it produces is someone under 19 inside the
// product. The screen that asks is where the rule is *shown*; this is where it is
// *decided*.
//
// Only the year is ever stored (decisions Part 3). The full date exists for exactly
// as long as it takes to answer this question.

export const MINIMUM_AGE = 19;

// Whole years, on the day, in UTC. Returns null when the three numbers are not a
// real date — 31 February is not an age, and "we cannot tell" must never be read as
// "old enough".
export function ageOn(day: number, month: number, year: number, now = new Date()): number | null {
  if (!day || !month || !year) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > now.getUTCFullYear()) return null;
  const birth = new Date(Date.UTC(year, month - 1, day));
  // Rolled over, so the day or month was not real.
  if (birth.getUTCDate() !== day || birth.getUTCMonth() !== month - 1) return null;
  let age = now.getUTCFullYear() - year;
  const hadBirthdayThisYear =
    now.getUTCMonth() > month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

// **Old enough is a positive answer, never the absence of a negative one.** An
// unreadable date is not old enough, and this function is the only place that says so.
export function isOldEnough(age: number | null): boolean {
  return age !== null && age >= MINIMUM_AGE;
}

// The three date-of-birth dropdowns (UI pass 1, 024: Month / Day / Year). **The years
// start at the youngest allowed age**, so nobody scrolls past years that can only end in
// the 19+ stop; someone born in the first year listed whose birthday is still to come is
// 18, and ageOn and isOldEnough still say so (H8: the stop is the rule, not the list).
// A century of years is plenty, and the list never reaches past ageOn's 1900 floor.
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function birthYears(now = new Date()): number[] {
  const newest = now.getUTCFullYear() - MINIMUM_AGE;
  return Array.from({ length: 100 }, (_, i) => newest - i).filter((y) => y >= 1900);
}

export function daysIn(month: number, year: number | null): number {
  if (!month) return 31;
  return new Date(Date.UTC(year || 2000, month, 0)).getUTCDate();
}
