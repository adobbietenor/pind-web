// The room and small groups, read and written as the signed-in person (M3.3).
//
// **Everything here goes through RLS** (H11): the members, the messages and the groups
// are whatever the database hands this person — nothing is filtered in the app. The
// read rules are V20–V22 (docs/visibility.md), proved by P139–P166.
//
// **The room is two things since the thread pass (16 Oct 2026):** this shell — who is
// here, the gathering, the mix — read when the screen opens and on a slow timer, and the
// thread (lib/thread.ts), which a message changes by one row. A message never reloads
// the shell, and the shell never re-signs a face whose URL is still good (signed-photos).
//
// **Nothing is ever sent for anyone.** `sendRoomMessage` and `sendGroupMessage` are the
// only writes of a message, and they are called only from a Send button (S29).

import { ALL_TAGS, type Convening, type ThreadRow } from "@pind/shared";
import { SessionProblem, whoAmI } from "./session";
import { signedPhotoUrls } from "./signed-photos";
import { supabase } from "./supabase";

export interface RoomSummary {
  roomId: string;
  number: number;
  womenOnly: boolean;
  members: number;
  open: boolean;
}

// Where I am at a gathering: my general room, and the women-only room when it is offered.
export async function myRooms(gatheringId: string): Promise<RoomSummary[]> {
  const { data, error } = await supabase().rpc("my_rooms", { p_gathering: gatheringId });
  if (error) throw error;
  return ((data ?? []) as { room_id: string; number: number; women_only: boolean; members: number; open: boolean }[]).map((r) => ({
    roomId: r.room_id,
    number: r.number,
    womenOnly: r.women_only,
    members: r.members,
    open: r.open,
  }));
}

export interface Member {
  personId: string;
  firstName: string;
  neighbourhood: string | null;
  photoUrl: string | null;
  // The file the URL is for: the image's cache key, so a renewed URL is not a new download.
  photoPath: string | null;
  tags: string[];
  joinedAt: string;
  posted: boolean;
}

export interface RoomView {
  roomId: string;
  gathering: { id: string; name: string; slug: string; convening: Convening; startsAt: string; closesAt: string };
  womenOnly: boolean;
  // The gathering's public mix (gathering_counts, the list's own numbers and its floor of
  // 5) — never a count of this room, which next to it could single someone out.
  mix: string | null;
  me: { personId: string; posted: boolean; tags: string[]; inGroup: boolean };
  members: Member[];
}

export const tagName = (slug: string) => ALL_TAGS.find((t) => t.slug === slug)?.name ?? slug;

function mixLine(rows: unknown): string | null {
  const c = (rows as { women: number | null; men: number | null; other: number | null }[] | null)?.[0];
  if (!c || c.women === null || c.men === null) return null;
  return [`${c.women} women`, `${c.men} men`, ...(c.other ? [`${c.other} other`] : [])].join(" · ");
}

// Who I am, as a person id: one read. (The full profile is four, and the shell needs none of it.)
export async function myPersonId(): Promise<string | null> {
  const read = await whoAmI();
  if (read.state !== "in") throw new SessionProblem(read);
  const { data, error } = await supabase().from("people").select("id").eq("auth_user_id", read.userId).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// The shell: everything on the room's screen except its messages.
export async function loadRoomShell(roomId: string): Promise<RoomView | null> {
  const db = supabase();
  const me = { personId: await myPersonId() };
  if (!me.personId) return null;
  const { data: room, error: roomError } = await db.from("rooms").select("id, gathering_id, women_only").eq("id", roomId).maybeSingle();
  if (roomError) throw roomError;
  if (!room) return null;
  const [{ data: g, error: gError }, convening, rows, myTags, counts, groups] = await Promise.all([
    db.from("gatherings").select("id, name, slug, starts_at, ends_at").eq("id", room.gathering_id).maybeSingle(),
    db.rpc("convening_of", { p_gathering: room.gathering_id }),
    db.from("room_members").select("person_id, joined_at, first_posted_at, left_at").eq("room_id", roomId),
    db.from("person_tags").select("tag").eq("person_id", me.personId),
    db.rpc("gathering_counts", { gathering_ids: [room.gathering_id] }),
    // Only my own groups come back (crews_read_members).
    // Groups only: a 1-on-1 plan does not stop "go together" (M3.4).
    db.from("crews").select("id").eq("gathering_id", room.gathering_id).eq("kind", "crew").in("state", ["forming", "spot_set", "live"]),
  ]);
  if (gError) throw gError;
  if (!g) return null;
  if (rows.error) throw rows.error;
  const active = (rows.data ?? []).filter((r) => !r.left_at);
  const mine = active.find((r) => r.person_id === me.personId);
  const others = active.filter((r) => r.person_id !== me.personId);
  const ids = others.map((r) => r.person_id);
  const [{ data: people }, { data: tags }] = await Promise.all([
    ids.length ? db.from("people").select("id, first_name, neighbourhood, photo_path").in("id", ids) : Promise.resolve({ data: [] as { id: string; first_name: string; neighbourhood: string | null; photo_path: string | null }[] }),
    ids.length ? db.from("person_tags").select("person_id, tag").in("person_id", ids).eq("on_list", true) : Promise.resolve({ data: [] as { person_id: string; tag: string }[] }),
  ]);
  const urlFor = await signedPhotoUrls((people ?? []).map((p) => p.photo_path));
  const effectiveEnd = g.ends_at ? Date.parse(g.ends_at) : Date.parse(g.starts_at) + 180 * 60_000;
  return {
    roomId,
    gathering: {
      id: g.id,
      name: g.name,
      slug: g.slug ?? g.id,
      convening: (convening.data as Convening) ?? "a_spot_first",
      startsAt: g.starts_at,
      closesAt: new Date(effectiveEnd + 24 * 3_600_000).toISOString(),
    },
    womenOnly: room.women_only,
    mix: mixLine(counts.data),
    me: { personId: me.personId, posted: !!mine?.first_posted_at, tags: (myTags.data ?? []).map((t) => t.tag), inGroup: (groups.data ?? []).length > 0 },
    // Only the people RLS lets me see come back from `people`: anyone else is left out.
    members: others
      .map((r) => {
        const p = (people ?? []).find((x) => x.id === r.person_id);
        if (!p) return null;
        return {
          personId: p.id,
          firstName: p.first_name,
          neighbourhood: p.neighbourhood,
          photoUrl: p.photo_path ? urlFor.get(p.photo_path) ?? null : null,
          photoPath: p.photo_path,
          tags: (tags ?? []).filter((t) => t.person_id === p.id).map((t) => t.tag),
          joinedAt: r.joined_at,
          posted: !!r.first_posted_at,
        };
      })
      .filter((m): m is Member => !!m)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
  };
}

// A tag I share with someone in the room, for the arrival card and the first opener.
export function sharedTag(mine: string[], theirs: string[]): string | null {
  const t = theirs.find((x) => mine.includes(x));
  return t ? tagName(t) : null;
}

// The only write of a room message: called from the Send button, never anywhere else (S29).
// It answers with the row it wrote (readable by its author), which confirms the message
// the screen is already showing — no read of the room after it.
export async function sendRoomMessage(roomId: string, personId: string, body: string): Promise<ThreadRow> {
  const { data, error } = await supabase().from("room_messages").insert({ room_id: roomId, author_id: personId, body: body.trim() }).select("id, author_id, body, created_at").single();
  if (error) throw error;
  return data;
}

// A removal, not a row delete (L9, 6 Oct 2026): a DELETE is broadcast to every Realtime
// subscriber, a removal only to people who could read the message — and they no longer can.
export async function deleteRoomMessage(id: string): Promise<void> {
  const { error } = await supabase().rpc("delete_room_message", { p_message: id });
  if (error) throw error;
}

// Long-press someone else's message → "Report <name>": a report on the PERSON, never the
// message (Alex, 16 Oct 2026). It carries where it came from — the room or the thread —
// and the message's own time, so the admin can go and look; never the words. The database
// checks the reporter can read that message, by that person, there, then
// (reports_insert_from_a_message) — so the place cannot point anywhere else.
export type ReportReason = "uncomfortable" | "not_who_they_said" | "under_19" | "spam";
export async function reportFromMessage(
  reporterId: string,
  message: { authorId: string; createdAt: string },
  where: { roomId: string } | { crewId: string },
  reason: ReportReason,
): Promise<void> {
  const { error } = await supabase()
    .from("reports")
    .insert({
      reporter_id: reporterId,
      target_kind: "person",
      target_person_id: message.authorId,
      reason,
      context_room_id: "roomId" in where ? where.roomId : null,
      context_crew_id: "crewId" in where ? where.crewId : null,
      context_at: message.createdAt,
    });
  if (error) throw error;
}

// "I've looked at the room" — what holds back #6 (room activity) while you are reading:
// it is not sent to anyone seen in the last two minutes. Marked when the room comes into
// view and, while it stays there, at most once a minute as messages arrive — never on a
// shell refresh, which says nothing about whether anyone looked.
export async function markSeen(roomId: string): Promise<void> {
  await supabase().rpc("room_seen", { p_room: roomId });
}

// The only write of a group message: called from the group's Send button (S29).
export async function sendGroupMessage(crewId: string, personId: string, body: string): Promise<ThreadRow> {
  const { data, error } = await supabase().from("crew_messages").insert({ crew_id: crewId, author_id: personId, kind: "user", body: body.trim() }).select("id, author_id, body, created_at").single();
  if (error) throw error;
  return data;
}
