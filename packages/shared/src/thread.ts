// A conversation's messages, held on the phone: the room (A10), a squad (A11) and a 1-on-1
// plan (A29) all keep their thread through these functions (the thread pass, 16 Oct 2026).
//
// **Why this is shared code, not a screen detail.** Until this pass every Realtime event,
// every Send and every 15-second poll reloaded the whole room — the profile, the people,
// their tags and a fresh signed URL for every face — so one person typing re-downloaded
// the room and re-fetched every avatar. Now a new row is merged into what the phone
// already holds, and these functions are the only way the held thread changes. They are
// pure, so `tests/unit/thread.test.ts` proves each rule by making it fire.
//
// Nothing here decides who may read a message (H11). Every row arrives from the database
// as the signed-in person — a page read, a "since" read or a Realtime row — so RLS has
// already chosen it. These functions only order, de-duplicate and reconcile.
//
//   * A message I send shows the instant I press Send ("sending"), becomes the real row
//     when the insert answers, or says it was not sent ("failed"). A failed one is never
//     re-sent for me: a tap puts its words back in the box (S29).
//   * My own insert also arrives over Realtime, often before the insert's answer: the
//     first copy to arrive takes the place of the sending one, and the second is dropped.
//   * A removal (L9) or a hide (H9) is an UPDATE nobody else receives — by design, it is
//     not broadcast. So a recheck reads the ids still there in a window and drops the
//     rest; it can only remove what it actually checked, never what arrived since.

export const THREAD_PAGE = 50;

export const THREAD_COPY = {
  send: "Send",
  sending: "Sending…",
  notSent: "Not sent. Tap to put it back in the box",
  earlier: "Earlier messages",
} as const;

export interface ThreadMessage {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  // Only on a message of mine that the database has not confirmed.
  status?: "sending" | "failed";
}

export interface ThreadState {
  messages: ThreadMessage[];
  hasOlder: boolean;
}

// A row as the database sends it — from a page read, a "since" read or Realtime.
export interface ThreadRow {
  id?: unknown;
  author_id?: unknown;
  body?: unknown;
  created_at?: unknown;
  kind?: unknown;
}

// A row the thread can show, or null. A group's system lines were never shown in the
// thread, so they are skipped here as they were before. A Realtime payload that came
// without its columns is refused rather than shown half-empty; the caller reads instead.
export function threadMessage(row: ThreadRow | null | undefined): ThreadMessage | null {
  if (!row || typeof row.id !== "string" || typeof row.body !== "string" || typeof row.created_at !== "string") return null;
  if (row.kind === "system") return null;
  return { id: row.id, authorId: typeof row.author_id === "string" ? row.author_id : "", body: row.body, createdAt: row.created_at };
}

// Two of the database's times. Postgres keeps microseconds and Date.parse keeps
// milliseconds, so within one millisecond the text decides (the database writes every
// time in one format).
const cmpTime = (a: string, b: string) => Date.parse(a) - Date.parse(b) || (a < b ? -1 : a > b ? 1 : 0);
const byTime = (a: ThreadMessage, b: ThreadMessage) => cmpTime(a.createdAt, b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const confirmed = (m: ThreadMessage) => !m.status;

// Confirmed messages in time order, then mine still in flight, in the order I sent them.
function settle(messages: ThreadMessage[]): ThreadMessage[] {
  const seen = new Set<string>();
  const real = messages.filter((m) => confirmed(m) && !seen.has(m.id) && (seen.add(m.id), true)).sort(byTime);
  return [...real, ...messages.filter((m) => !confirmed(m))];
}

// The newest page, read newest first with one row more than a page (that row says
// whether there is anything older).
export function firstPage(newestFirst: ThreadRow[], page = THREAD_PAGE): ThreadState {
  const rows = newestFirst.map(threadMessage).filter((m): m is ThreadMessage => !!m);
  return { messages: settle(rows.slice(0, page)), hasOlder: newestFirst.length > page };
}

// The page before the oldest held, read the same way.
export function withOlder(state: ThreadState, newestFirst: ThreadRow[], page = THREAD_PAGE): ThreadState {
  const rows = newestFirst.map(threadMessage).filter((m): m is ThreadMessage => !!m).slice(0, page);
  return { messages: settle([...rows, ...state.messages]), hasOlder: newestFirst.length > page };
}

// Rows that arrived — over Realtime or from a "since" read. Each is added once. One of
// mine takes the place of the first unconfirmed message with the same words — sending,
// or marked failed when the answer was lost but the insert had in fact gone through.
export function withIncoming(state: ThreadState, rows: ThreadRow[], meId: string | null | undefined): ThreadState {
  let messages = state.messages;
  for (const m of rows.map(threadMessage)) {
    if (!m || messages.some((x) => x.id === m.id)) continue;
    const mine = meId && m.authorId === meId ? messages.findIndex((x) => !confirmed(x) && x.body.trim() === m.body.trim()) : -1;
    messages = mine >= 0 ? messages.map((x, i) => (i === mine ? m : x)) : [...messages, m];
  }
  return messages === state.messages ? state : { ...state, messages: settle(messages) };
}

// The newest page read again after a long gap (or into an empty thread): it replaces what
// is held, except mine still in flight, which it confirms if it already has them.
export function withFreshPage(state: ThreadState, newestFirst: ThreadRow[], meId: string | null | undefined, page = THREAD_PAGE): ThreadState {
  return withIncoming({ messages: state.messages.filter((m) => !confirmed(m)), hasOlder: newestFirst.length > page }, newestFirst.slice(0, page), meId);
}

// Pressed Send: on screen at once, marked as sending.
export function withSending(state: ThreadState, local: { localId: string; authorId: string; body: string; at: string }): ThreadState {
  return { ...state, messages: settle([...state.messages, { id: local.localId, authorId: local.authorId, body: local.body.trim(), createdAt: local.at, status: "sending" }]) };
}

// The insert answered. If Realtime already delivered the row, the sending copy is dropped.
export function withConfirmed(state: ThreadState, localId: string, row: ThreadRow): ThreadState {
  const m = threadMessage(row);
  const rest = state.messages.filter((x) => x.id !== localId);
  return { ...state, messages: settle(m && !rest.some((x) => x.id === m.id) ? [...rest, m] : rest) };
}

// The insert was refused or never answered. It stays, saying so, until I take it back.
export function withFailed(state: ThreadState, localId: string): ThreadState {
  return { ...state, messages: state.messages.map((x) => (x.id === localId && x.status === "sending" ? { ...x, status: "failed" as const } : x)) };
}

// Gone from this phone: my own removal, or a failed message taken back into the box.
export function without(state: ThreadState, id: string): ThreadState {
  return { ...state, messages: state.messages.filter((x) => x.id !== id) };
}

// The newest confirmed message's time: where a "since" read starts.
export function newestConfirmed(state: ThreadState): string | null {
  for (let i = state.messages.length - 1; i >= 0; i--) if (confirmed(state.messages[i])) return state.messages[i].createdAt;
  return null;
}

// The window a recheck reads: the newest `count` confirmed messages, from the oldest of
// them to the newest. Null when there is nothing to recheck.
export function recheckWindow(state: ThreadState, count = THREAD_PAGE): { from: string; to: string } | null {
  const real = state.messages.filter(confirmed);
  if (!real.length) return null;
  return { from: real[Math.max(0, real.length - count)].createdAt, to: real[real.length - 1].createdAt };
}

// The ids still readable between `from` and `to`, both ends included: anything held in
// that window and not among them was removed or hidden. Outside the window, and mine in
// flight, are left alone — the read did not look at them.
export function withRecheck(state: ThreadState, window: { from: string; to: string }, stillThere: string[]): ThreadState {
  const keep = new Set(stillThere);
  const messages = state.messages.filter((m) => !confirmed(m) || keep.has(m.id) || cmpTime(m.createdAt, window.from) < 0 || cmpTime(m.createdAt, window.to) > 0);
  return messages.length === state.messages.length ? state : { ...state, messages };
}
