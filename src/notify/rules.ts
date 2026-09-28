// The rules of delivering a notification (M3.3), pure so a unit test can load them
// without the Worker: where each goes, the signed stop link, the email's words.
// Used by src/notify/deliver.ts and src/notify/stop.ts.

export const SITE = "https://pind.social";

export type NotificationKind = "digest" | "room_open" | "plan_status" | "day_of" | "next_morning" | "room_activity";

export interface Pending {
  id: string;
  person_id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  path: string;
  attempts: number;
  tokens: string[];
  email: string | null;
}

export type Channel = "push" | "email" | "none";

// Where one notification goes. Push when there is a phone and push can be sent; email
// when there is an address and email can be sent; otherwise nowhere, recorded.
export function channelFor(n: Pick<Pending, "tokens" | "email">, can: { push: boolean; email: boolean }): Channel {
  if (can.push && n.tokens.length > 0) return "push";
  if (can.email && n.email && n.email.trim()) return "email";
  return "none";
}

// ---------------------------------------------------------------------------
// The one-tap "stop these" link: HMAC-signed, so only the link we sent works.
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function stopToken(secret: string, personId: string, kind: NotificationKind): Promise<string> {
  return hmac(secret, `stop:${personId}:${kind}`);
}

export async function stopUrl(secret: string, personId: string, kind: NotificationKind): Promise<string> {
  const t = await stopToken(secret, personId, kind);
  return `${SITE}/account/stop?p=${encodeURIComponent(personId)}&k=${kind}&t=${t}`;
}

// Compared after normalising both sides the same way (CLAUDE.md, the instrument rule).
export async function stopTokenValid(secret: string, personId: string, kind: string, token: string): Promise<boolean> {
  if (!KINDS.includes(kind as NotificationKind)) return false;
  const want = await stopToken(secret, personId.trim(), kind as NotificationKind);
  const got = token.trim();
  if (want.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export const KINDS: NotificationKind[] = ["digest", "room_open", "plan_status", "day_of", "next_morning", "room_activity"];

export const KIND_NAME: Record<NotificationKind, string> = {
  digest: "the Monday digest",
  room_open: "\"someone else wants to meet\"",
  plan_status: "group and plan updates",
  day_of: "day-of reminders",
  next_morning: "the next-morning check-in",
  room_activity: "room activity",
};

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

export function emailFor(n: Pick<Pending, "title" | "body" | "path" | "kind">, stop: string): { subject: string; text: string } {
  return {
    subject: n.body,
    text: [
      n.body,
      "",
      `Open it: ${SITE}${n.path}`,
      "",
      `Stop ${KIND_NAME[n.kind]} emails: ${stop}`,
      "",
      "Pin'd — see who's going, meet them there.",
    ].join("\n"),
  };
}

