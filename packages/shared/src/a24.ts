// A24 — report and block: its words (Alex, 16 Nov 2026; spec A24; H9). PROPOSED copy,
// Tatiana's to reword. What each act does is the database's; these only say it.

export const A24_COPY = {
  more: "More",
  report: (name: string) => `Report ${name}`,
  squadNamed: (name: string) => `the squad ${name}`,
  reportHint: "What happened? They aren't told who reported them.",
  reportedTitle: "Thanks for telling us",
  reportedLine: "A person reviews every report within 24 hours. You won't be matched with them for 1-on-1, and any chat you had with them has ended.",
  block: (name: string) => `Block ${name}`,
  blockWhat:
    "You won't see each other anywhere on Pin'd: not on crowd pages, in rooms or in chats. Your chat and connection end, and you leave any squad you share. They aren't told. You can unblock in Settings.",
  blockConfirm: "Block",
  blockedTitle: (name: string) => `You've blocked ${name}`,
  blockedLine: "They aren't told. You can undo this in Settings → Blocked people.",
  back: "Back",
  cancel: "Cancel",
  done: "Done",
  // Settings → Blocked people.
  blockedHeading: "Blocked people",
  blockedNone: "You haven't blocked anyone.",
  unblock: "Unblock",
  unblockWhat:
    "Unblocking lets you see each other again at events you're both going to, and you can ask each other for a 1-on-1 or keep in touch again. It doesn't bring back your old chat or connection, a squad you left, or a 1-on-1 that was called off. They aren't told.",
  unblocked: (name: string) => `${name} is unblocked.`,
  // A banned account signing in (the admin's ban).
  suspended: "This account is suspended. If you think this is a mistake, write to safety@pind.social.",
} as const;
