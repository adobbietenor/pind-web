// The merge’s four checks (M3.2), pure so a unit test can make each one fire
// (M04–M08) without loading the Worker. Used by src/account/merge.ts.

export interface VouchedUser {
  id: string;
  is_anonymous?: boolean;
}

// The four checks, as one decision with a reason. Null means go.
export function mergeRefusal(anon: VouchedUser | null, perm: VouchedUser | null): string | null {
  if (!anon || !perm) return "a session is not valid";
  if (anon.is_anonymous !== true) return "the first session is not anonymous";
  if (perm.is_anonymous !== false) return "the second session is not permanent";
  if (anon.id === perm.id) return "both sessions are the same person";
  return null;
}

// Where the anonymous person's photo lands in the account: the account's own folder,
// same file name (the bucket's owner policies key on the first folder being the user's
// id). The database refuses any other destination (P131); this is its one producer.
export function photoDest(permId: string, fromPath: string): string {
  const name = fromPath.split("/").pop() ?? "";
  if (!name || name === ".." || name === ".") throw new Error("no file name to move");
  return `${permId}/${name}`;
}

// How this merge came about, for its record (M3.3, spec §7 "Session lost (web)"): what
// the app says, kept only when it is one of the known values — anything else is recorded
// as not known, never guessed. The database checks the same lists (admin_merge_recorded).
export interface MergeContext {
  method: "email" | "apple" | "google" | null;
  platform: "web" | "ios" | "android" | null;
  via: "already_on_pind" | "sign_in_step" | null;
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;

export function mergeContext(body: unknown): MergeContext {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    method: oneOf(b.method, ["email", "apple", "google"] as const),
    platform: oneOf(b.platform, ["web", "ios", "android"] as const),
    via: oneOf(b.via, ["already_on_pind", "sign_in_step"] as const),
  };
}
