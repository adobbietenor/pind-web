// Comparing two halves of a shared secret (Phase 3 M3.1).
//
// **No imports, on purpose.** This is the piece the unit tests load under bare node —
// a module only a deploy can execute is a module nobody checks (the rule map.ts and
// time.ts are written to). The rendering that needs the admin's helpers stays in
// webhook.ts.
//
// **The rule this file exists to keep** (CLAUDE.md, "An instrument that is wrong in a
// way that looks like a finding"): when two values are compared, both sides are
// normalised identically **at the point of comparison**, and the comparison is tested
// with a pair that differs only in whitespace. The first version of this panel
// fingerprinted one side trimmed and the other as stored, and then reported the
// difference between its own two rulers as a difference between the secrets.

export interface WebhookHealth {
  url: string | null;
  secret_set: boolean;
  secret_fingerprint: string | null;
  secret_padded: boolean;
  last_at: string | null;
  last_status: number | null;
  last_error: string | null;
  last_body: string | null;
  waiting: number;
}

// The first ten hex characters of the SHA-256 of the **trimmed** value — which is what
// the database fingerprints too. Ten hex characters of a hash of a high-entropy secret
// reveal nothing anyone can work backwards from.
export async function fingerprint(secret: string | undefined): Promise<string | null> {
  const value = (secret ?? "").trim();
  if (!value) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

export type Verdict =
  | { state: "match"; text: string }
  | { state: "differ"; text: string }
  | { state: "missing"; text: string };

// Missing and differing are kept apart because they want different actions: one is
// "set it", the other is "set it to the same thing".
export function compare(db: WebhookHealth, worker: string | null): Verdict {
  if (!db.secret_set && !worker) {
    return { state: "missing", text: "Neither half is set, so the webhook is refused and photos are checked only when the app asks." };
  }
  if (!db.secret_set) {
    return { state: "missing", text: "The database half is missing. Create the Vault secret photo_check_secret." };
  }
  if (!worker) {
    return { state: "missing", text: "The Worker half is missing. Set it with npx wrangler secret put PHOTO_WEBHOOK_SECRET." };
  }
  if (db.secret_fingerprint === worker) {
    return { state: "match", text: "Both halves are the same value." };
  }
  return {
    state: "differ",
    text: "Both halves are set and they are DIFFERENT — which is why the webhook is answered 401. Set one to the other's value.",
  };
}
