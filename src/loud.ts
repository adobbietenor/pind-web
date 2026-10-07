// Jobs that cannot complete say so — and fail the run (Alex, 6 Oct 2026).
//
// The photo sweep reported "Looked at 20: … 20 the check could not complete" every hour
// as an ordinary, successful run, while staging's sweep failed the same missing photos
// forever. That is the stale test crowd's shape: a silent failure that looks like
// success. So the hourly cron runs every job (one failing must not stop the others —
// the old rule, kept), logs each, and then, if any job threw or reported work it could
// not complete, throws: the invocation is marked failed in Cloudflare and the reason is
// the error, not a line among the logs.

export interface JobResult {
  message: string;
  // Work the job could not complete — e.g. photo checks that failed to run.
  failed?: number;
}

export async function runJobsLoudly(
  jobs: { name: string; run: () => Promise<JobResult> }[],
  log: (line: string) => void = (l) => console.log(l),
): Promise<void> {
  const problems: string[] = [];
  for (const job of jobs) {
    try {
      const out = await job.run();
      log(out.message);
      if ((out.failed ?? 0) > 0) problems.push(`${job.name}: ${out.failed} could not complete — ${out.message}`);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      log(`${job.name} failed: ${why}`);
      problems.push(`${job.name} failed: ${why}`);
    }
  }
  if (problems.length) throw new Error(`Could not complete — ${problems.join(" | ")}`);
}
