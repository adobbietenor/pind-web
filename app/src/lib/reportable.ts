// How a failure is handed to Sentry, shared by the app (sentry.ts) and the web
// (sentry.web.ts) so the two cannot drift. A PostgREST or Storage error is a plain
// object, not an Error, so it is wrapped to keep its message and code rather than
// arriving as "Non-Error exception".
export function reportable(err: unknown, doing: string) {
  const record = typeof err === "object" && err !== null ? (err as Record<string, unknown>) : {};
  const error =
    err instanceof Error ? err : new Error(typeof record.message === "string" ? record.message : String(err));
  return { error, context: { tags: { doing }, extra: { code: record.code, status: record.status ?? record.statusCode } } };
}
