// The seven notifications (spec A18: six since the room, Alex 28 Sept 2026; the seventh,
// an invite from someone you've met, 29 Sept): their
// names, in one place. Settings shows them as switches; the Worker's emails name the one
// they are stopping. A switch is on unless the person switched it off.

export type NotificationKind = "digest" | "room_open" | "plan_status" | "day_of" | "next_morning" | "room_activity" | "invite";

export const NOTIFICATIONS: { kind: NotificationKind; label: string; what: string }[] = [
  { kind: "room_open", label: "Someone else wants to meet", what: "The first time someone else at a gathering you pinned says they'd like to meet." },
  { kind: "room_activity", label: "Room activity", what: "New messages in a room since you last looked — at most once an hour." },
  { kind: "plan_status", label: "Groups and plans", what: "An invite, a group's plan, or a group that closed." },
  { kind: "day_of", label: "On the day", what: "About three hours before, where and when your group meets." },
  { kind: "next_morning", label: "The morning after", what: "Did you meet up, or how the night went." },
  { kind: "invite", label: "Invites from people you've met", what: "Someone you kept in touch with is going to something and asks if you'd like to come." },
  { kind: "digest", label: "Monday's crowds", what: "This week's crowds, every Monday at 6 pm." },
];

// How an email names the kind it is stopping ("Stop room activity emails").
export const NOTIFICATION_NAME: Record<NotificationKind, string> = Object.fromEntries(
  NOTIFICATIONS.map((n) => [n.kind, n.label.toLowerCase()]),
) as Record<NotificationKind, string>;

// The pre-prompt, shown before the phone's own permission request — never on launch,
// only once someone is in a room and push has something to say (Tatiana's to reword).
export const PUSH_ASK = {
  title: "Get told when someone says hi",
  line: "We'll let you know when someone else wants to meet, and when your room is talking — never more than once an hour.",
  yes: "Turn on",
  no: "Not now",
} as const;

// A phone's push registration moved to another account (L8; Alex, 6 Oct 2026). Allowed —
// re-registering is how a phone changes hands — but never silent: on the next start, a
// phone that registered itself for this account, and finds the server no longer has it
// for this account, says so instead of quietly taking it back. A phone that last
// registered for someone ELSE is a phone that changed hands: no line, just register.
export function pushWasTaken(o: {
  local: { token: string; userId: string } | null;
  token: string;
  userId: string;
  serverHasIt: boolean;
}): boolean {
  return !!o.local && o.local.token === o.token && o.local.userId === o.userId && !o.serverHasIt;
}

// PROPOSED copy (Tatiana's to reword).
export const PUSH_TAKEN = {
  title: "Notifications are off on this phone",
  line: "Another Pin'd account turned them on for this phone, so they stopped coming to you.",
  yes: "Turn them back on",
  no: "Leave them off",
} as const;
