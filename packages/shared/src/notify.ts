// The six notifications (spec A18, six since the room — Alex, 28 Sept 2026): their
// names, in one place. Settings shows them as switches; the Worker's emails name the one
// they are stopping. A switch is on unless the person switched it off.

export type NotificationKind = "digest" | "room_open" | "plan_status" | "day_of" | "next_morning" | "room_activity";

export const NOTIFICATIONS: { kind: NotificationKind; label: string; what: string }[] = [
  { kind: "room_open", label: "Someone else wants to meet", what: "The first time someone else at a gathering you pinned says they'd like to meet." },
  { kind: "room_activity", label: "Room activity", what: "New messages in a room since you last looked — at most once an hour." },
  { kind: "plan_status", label: "Groups and plans", what: "An invite, a group's plan, or a group that closed." },
  { kind: "day_of", label: "On the day", what: "About three hours before, where and when your group meets." },
  { kind: "next_morning", label: "The morning after", what: "Did you meet up?" },
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
