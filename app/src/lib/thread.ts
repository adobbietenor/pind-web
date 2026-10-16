// A thread on the phone — the room (A10), a squad (A11), a 1-on-1 plan (A29) — kept
// apart from the screen around it (the thread pass, 16 Oct 2026).
//
// **A message costs one row, not one room.** Before this pass every Realtime event,
// every Send and every 15-second poll reloaded the whole room: measured in real Chrome,
// 15 Supabase requests and every avatar downloaded again for each message someone else
// posted (`npm run measure:thread`). Now:
//
//   * the newest page (THREAD_PAGE) is read once, through TanStack Query, and older
//     pages only when asked for ("Earlier messages");
//   * a Realtime INSERT carries its own row, and that row is merged in — no read at all;
//   * Send shows the message at once, and the insert's answer confirms it (or says it
//     was not sent) — see packages/shared/src/thread.ts;
//   * the poll is the net, not the feed: "messages since the newest I hold", every 10 s
//     while Realtime is down (decisions, "Realtime via postgres_changes only": "poll every
//     10 seconds while the thread is open") and every 60 s while it is healthy;
//   * a removal or a hide is never broadcast (L9), so once a minute the poll also reads
//     the ids still there among the newest page, and drops what is gone.
//
// **Everything is read as the signed-in person** (H11): the page reads, the "since" read,
// the recheck and the Realtime rows are all what RLS hands this person. Nothing here
// filters by who someone is. Realtime is postgres_changes only — broadcast ignores RLS.
//
// **Nothing is sent for anyone** (S29): `post` takes the screen's own write, called from
// the screen's Send; a failed message is never retried here — `takeBack` returns its
// words for the box, and the person sends again or doesn't.
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  firstPage,
  newestConfirmed,
  recheckWindow,
  THREAD_PAGE,
  withConfirmed,
  withFailed,
  withFreshPage,
  withIncoming,
  withOlder,
  withRecheck,
  withSending,
  without,
  type ThreadMessage,
  type ThreadRow,
  type ThreadState,
} from "@pind/shared";
import { queryClient } from "./query";
import { supabase } from "./supabase";

export type ThreadKind = "room" | "group";

const POLL_HEALTHY_MS = 60_000;
const POLL_FALLBACK_MS = 10_000;
const RECHECK_MS = 60_000;
// A "since" read this long means a long gap: start again from the newest page.
const SINCE_LIMIT = 100;

const SOURCE = {
  room: { table: "room_messages", column: "room_id" },
  group: { table: "crew_messages", column: "crew_id" },
} as const;

// The few PostgREST calls a thread read makes. Two tables with different row types,
// read the same way; typed here once rather than cast at every call.
interface Rows extends PromiseLike<{ data: ThreadRow[] | null; error: unknown }> {
  order(column: string, options: { ascending: boolean }): Rows;
  limit(n: number): Rows;
  gte(column: string, value: string): Rows;
  lte(column: string, value: string): Rows;
}

function read(kind: ThreadKind, id: string, columns: string): Rows {
  const db = supabase();
  if (kind === "room") return db.from("room_messages").select(columns).eq("room_id", id) as unknown as Rows;
  // A group's thread never showed its system lines; they are left out of the read.
  return db.from("crew_messages").select(columns).eq("crew_id", id).neq("kind", "system") as unknown as Rows;
}
const COLUMNS = "id, author_id, body, created_at";

async function rows(q: Rows): Promise<ThreadRow[]> {
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export const threadKey = (kind: ThreadKind, id: string) => ["thread", kind, id] as const;

let localSeq = 0;

export function useThread(
  kind: ThreadKind,
  id: string,
  {
    meId,
    focused,
    onIncoming,
  }: {
    meId: string | null | undefined;
    focused: boolean;
    // Someone else's message arrived — for the screen's own reaction (a seen mark, a
    // shell refresh when the author is someone it has not met). Never a reload of the thread.
    onIncoming?: (m: ThreadMessage) => void;
  },
) {
  const key = useMemo(() => threadKey(kind, id), [kind, id]);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => firstPage(await rows(read(kind, id, COLUMNS).order("created_at", { ascending: false }).limit(THREAD_PAGE + 1))),
    // The thread is kept current by the rows themselves: never refetched wholesale.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const meRef = useRef(meId);
  meRef.current = meId;
  const incomingRef = useRef(onIncoming);
  incomingRef.current = onIncoming;
  const [healthy, setHealthy] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const lastRecheck = useRef(0);
  // Rows that arrive before the first page has: merged the moment it lands.
  const early = useRef<ThreadRow[]>([]);

  const change = useCallback((fn: (s: ThreadState) => ThreadState) => {
    queryClient.setQueryData<ThreadState>(key, (s) => (s ? fn(s) : s));
  }, [key]);
  const held = useCallback(() => queryClient.getQueryData<ThreadState>(key), [key]);

  const arrived = useCallback(
    (incoming: ThreadRow[]) => {
      const before = held();
      if (!before) {
        early.current.push(...incoming);
        return;
      }
      change((s) => withIncoming(s, incoming, meRef.current));
      const after = held();
      for (const m of after?.messages ?? []) {
        if (!before.messages.some((x) => x.id === m.id) && m.authorId !== meRef.current && !m.status) incomingRef.current?.(m);
      }
    },
    [change, held],
  );

  useEffect(() => {
    if (query.data && early.current.length) {
      const rowsIn = early.current;
      early.current = [];
      arrived(rowsIn);
    }
  }, [query.data, arrived]);

  // The net: what arrived since the newest I hold, and — at most once a minute — which
  // of the newest page are still there. Never the page again, never the room.
  const catchUp = useCallback(
    async (recheck: boolean) => {
      const s = held();
      if (!s) return;
      const since = newestConfirmed(s);
      const window = recheck || Date.now() - lastRecheck.current >= RECHECK_MS ? recheckWindow(s) : null;
      try {
        const [fresh, still] = await Promise.all([
          since ? rows(read(kind, id, COLUMNS).gte("created_at", since).order("created_at", { ascending: true }).limit(SINCE_LIMIT)) : Promise.resolve(null),
          window ? rows(read(kind, id, "id").gte("created_at", window.from).lte("created_at", window.to)) : Promise.resolve(null),
        ]);
        // Nothing held yet, or a gap too long to stitch: the newest page, keeping mine in flight.
        if (!since || (fresh && fresh.length >= SINCE_LIMIT)) {
          const page = await rows(read(kind, id, COLUMNS).order("created_at", { ascending: false }).limit(THREAD_PAGE + 1));
          change((x) => withFreshPage(x, page, meRef.current));
          return;
        }
        if (still && window) {
          lastRecheck.current = Date.now();
          change((x) => withRecheck(x, window, still.map((r) => String(r.id))));
        }
        if (fresh?.length) arrived(fresh);
      } catch {
        // A missed poll is caught by the next one; the thread on screen stays as it is.
      }
    },
    [kind, id, change, held, arrived],
  );

  // Realtime: the row itself. postgres_changes is filtered by RLS for this person.
  useEffect(() => {
    let wasDown = false;
    const { table, column } = SOURCE[kind];
    const channel = supabase()
      .channel(`${kind}:${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table, filter: `${column}=eq.${id}` }, (payload) => {
        const row = payload.new as ThreadRow;
        // A payload without its columns is read instead of shown half-empty.
        if (typeof row?.id !== "string" || typeof row?.body !== "string") void catchUp(false);
        else arrived([row]);
      })
      .subscribe((status) => {
        const up = status === "SUBSCRIBED";
        setHealthy(up);
        // Back after a gap: whatever was said meanwhile, once.
        if (up && wasDown) void catchUp(true);
        if (!up) wasDown = true;
      });
    return () => {
      void supabase().removeChannel(channel);
    };
  }, [kind, id, arrived, catchUp]);

  // The poll, only while the screen is in front: slow while Realtime is healthy.
  useEffect(() => {
    if (!focused) return;
    void catchUp(true);
    const t = setInterval(() => void catchUp(false), healthy ? POLL_HEALTHY_MS : POLL_FALLBACK_MS);
    return () => clearInterval(t);
  }, [focused, healthy, catchUp]);

  const loadOlder = useCallback(async () => {
    const s = held();
    const oldest = s?.messages.find((m) => !m.status);
    if (!s || !oldest || olderBusy) return;
    setOlderBusy(true);
    try {
      // `lte` and not `lt`: two messages can share the oldest's time; the held one is dropped as a repeat.
      const page = await rows(read(kind, id, COLUMNS).lte("created_at", oldest.createdAt).order("created_at", { ascending: false }).limit(THREAD_PAGE + 1));
      change((x) => withOlder(x, page));
    } finally {
      setOlderBusy(false);
    }
  }, [kind, id, held, change, olderBusy]);

  // Send: on screen now, confirmed by the insert's own answer. `write` is the screen's
  // send function — the only write of a message (S29). A refusal marks it and is rethrown
  // so the screen can say why, where the tap was.
  const post = useCallback(
    async (body: string, write: () => Promise<ThreadRow>) => {
      const me = meRef.current;
      if (!me || !held()) throw new Error("the thread is not ready");
      const localId = `local:${++localSeq}`;
      change((s) => withSending(s, { localId, authorId: me, body, at: new Date().toISOString() }));
      try {
        const row = await write();
        change((s) => withConfirmed(s, localId, row));
      } catch (err) {
        change((s) => withFailed(s, localId));
        throw err;
      }
    },
    [change, held],
  );

  // A failed message, taken back: off the thread, its words returned for the box.
  const takeBack = useCallback(
    (localId: string): string => {
      const m = held()?.messages.find((x) => x.id === localId && x.status === "failed");
      if (!m) return "";
      change((s) => without(s, localId));
      return m.body;
    },
    [change, held],
  );

  // My own removal: gone from this phone at once (the database has already cleared it).
  const forget = useCallback((messageId: string) => change((s) => without(s, messageId)), [change]);

  return {
    messages: query.data?.messages,
    hasOlder: query.data?.hasOlder ?? false,
    error: query.error,
    retry: () => void query.refetch(),
    loadOlder,
    olderBusy,
    post,
    takeBack,
    forget,
    // After a report, which can hide a message: check now rather than within the minute.
    recheck: () => void catchUp(true),
    healthy,
  };
}
