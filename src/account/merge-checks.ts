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
