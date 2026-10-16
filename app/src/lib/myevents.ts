// A19 — My Events, the home for your chats (Alex, 16 Oct 2026; until then the M3.2b list).
//
// **One call for the whole screen**: my_chats (supabase/migrations/20261016190356), read
// as the signed-in person — SECURITY INVOKER, so every row in it is one RLS already lets
// them read: their pins and those gatherings, their rooms and the room's messages, their
// squad and 1-on-1 threads, the names they may see, the squads listed to them, and A16's
// own state for a past night. No per-event or per-chat reads (the old list made 4 reads
// plus one per past event); what each row says is packages/shared/src/myevents.ts.
//
// The tab's unread dot reads the same query (MY_CHATS_KEY), so it costs nothing extra
// while the tab is open, and one call a minute while the app is elsewhere.
import { readMyChats, type MyChatsEvent } from "@pind/shared";
import { SessionProblem, whoAmI } from "./session";
import { supabase } from "./supabase";

export const MY_CHATS_KEY = ["my-chats"] as const;

export type MyEvent = MyChatsEvent;

export async function loadMyChats(): Promise<MyChatsEvent[]> {
  const read = await whoAmI();
  // Signed out: no chats, and no session made for it — the tab's dot simply stays off.
  if (read.state === "out") return [];
  if (read.state !== "in") throw new SessionProblem(read);
  const { data, error } = await supabase().rpc("my_chats");
  if (error) throw error;
  return readMyChats(data);
}
