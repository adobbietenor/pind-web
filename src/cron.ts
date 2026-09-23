// Which job a cron trigger runs (M3.1).
//
// **Written because the scheduled handler had a trap in it.** It matched the photo
// sweep and the liveness check by their cron strings and let *anything else* fall
// through to the nightly Ticketmaster import. Making the sweep hourly (Alex, M3.1:
// "nothing waits on the check", and the sweep caps how long a photo goes unchecked)
// meant a new cron string — and one typo away, that string would have run the import
// every hour. So the routing is one pure function, tested (tests/unit/cron.test.ts),
// in which an unknown cron runs **nothing** and says so.

export const IMPORT_CRON = "0 8 * * *";
export const LIVENESS_CRON = "0 13 * * *";
// Hourly. Free when nothing is waiting; caps an unchecked photo at an hour if the
// webhook is broken, rather than a day.
export const PHOTO_SWEEP_CRON = "0 * * * *";
// The credential-expiry watch rides the sweep's trigger once a day, at 09:00 UTC —
// one alert a day, as before.
export const CREDENTIALS_HOUR_UTC = 9;

export const CRONS = [IMPORT_CRON, PHOTO_SWEEP_CRON, LIVENESS_CRON] as const;

export type Job = "import" | "photo-sweep" | "credentials" | "liveness";

export function jobsFor(cron: string, scheduledTime: number): Job[] {
  if (cron === IMPORT_CRON) return ["import"];
  if (cron === LIVENESS_CRON) return ["liveness"];
  if (cron === PHOTO_SWEEP_CRON) {
    return new Date(scheduledTime).getUTCHours() === CREDENTIALS_HOUR_UTC ? ["photo-sweep", "credentials"] : ["photo-sweep"];
  }
  return [];
}
