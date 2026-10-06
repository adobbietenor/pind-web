// The room and small groups, read and written as the signed-in person (M3.3).
//
// **Everything here goes through RLS** (H11): the members, the messages and the groups
// are whatever the database hands this person — nothing is filtered in the app. The
// read rules are V20–V22 (docs/visibility.md), proved by P139–P166.
//
// **Nothing is ever sent for anyone.** `sendRoomMessage` and `sendGroupMessage` are the
// only writes of a message, and they are called only from a Send button (S29).

import { ALL_TAGS, type Convening } from "@pind/shared";
import { readProfile } from "./profile";
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
  tags: string[];
  joinedAt: string;
  posted: boolean;
}

export interface Message {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
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
  messages: Message[];
}

export const tagName = (slug: string) => ALL_TAGS.find((t) => t.slug === slug)?.name ?? slug;

function mixLine(rows: unknown): string | null {
  const c = (rows as { women: number | null; men: number | null; other: number | null }[] | null)?.[0];
  if (!c || c.women === null || c.men === null) return null;
  return [`${c.women} women`, `${c.men} men`, ...(c.other ? [`${c.other} other`] : [])].join(" · ");
}

export async function loadRoom(roomId: string): Promise<RoomView | null> {
  const db = supabase();
  const me = await readProfile();
  if (!me.personId) return null;
  const { data: room, error: roomError } = await db.from("rooms").select("id, gathering_id, women_only").eq("id", roomId).maybeSingle();
  if (roomError) throw roomError;
  if (!room) return null;
  const [{ data: g, error: gError }, convening, rows, msgs, myTags, counts, groups] = await Promise.all([
    db.from("gatherings").select("id, name, slug, starts_at, ends_at").eq("id", room.gathering_id).maybeSingle(),
    db.rpc("convening_of", { p_gathering: room.gathering_id }),
    db.from("room_members").select("person_id, joined_at, first_posted_at, left_at").eq("room_id", roomId),
    db.from("room_messages").select("id, author_id, body, created_at").eq("room_id", roomId).order("created_at").limit(300),
    db.from("person_tags").select("tag").eq("person_id", me.personId),
    db.rpc("gathering_counts", { gathering_ids: [room.gathering_id] }),
    // Only my own groups come back (crews_read_members).
    db.from("crews").select("id").eq("gathering_id", room.gathering_id).in("state", ["forming", "spot_set", "live"]),
  ]);
  if (gError) throw gError;
  if (!g) return null;
  if (rows.error) throw rows.error;
  if (msgs.error) throw msgs.error;
  const active = (rows.data ?? []).filter((r) => !r.left_at);
  const mine = active.find((r) => r.person_id === me.personId);
  const others = active.filter((r) => r.person_id !== me.personId);
  const ids = others.map((r) => r.person_id);
  const [{ data: people }, { data: tags }] = await Promise.all([
    ids.length ? db.from("people").select("id, first_name, neighbourhood, photo_path").in("id", ids) : Promise.resolve({ data: [] as { id: string; first_name: string; neighbourhood: string | null; photo_path: string | null }[] }),
    ids.length ? db.from("person_tags").select("person_id, tag").in("person_id", ids).eq("on_list", true) : Promise.resolve({ data: [] as { person_id: string; tag: string }[] }),
  ]);
  const paths = (people ?? []).map((p) => p.photo_path).filter((x): x is string => !!x);
  const signed = paths.length ? (await db.storage.from("photos").createSignedUrls(paths, 300)).data ?? [] : [];
  const urlFor = new Map(signed.filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));
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
          tags: (tags ?? []).filter((t) => t.person_id === p.id).map((t) => t.tag),
          joinedAt: r.joined_at,
          posted: !!r.first_posted_at,
        };
      })
      .filter((m): m is Member => !!m)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
    messages: (msgs.data ?? []).map((m) => ({ id: m.id, authorId: m.author_id, body: m.body, createdAt: m.created_at })),
  };
}

// A tag I share with someone in the room, for the arrival card and the first opener.
export function sharedTag(mine: string[], theirs: string[]): string | null {
  const t = theirs.find((x) => mine.includes(x));
  return t ? tagName(t) : null;
}

// The only write of a room message: called from the Send button, never anywhere else (S29).
export async function sendRoomMessage(roomId: string, personId: string, body: string): Promise<void> {
  const { error } = await supabase().from("room_messages").insert({ room_id: roomId, author_id: personId, body: body.trim() });
  if (error) throw error;
}

export async function deleteRoomMessage(id: string): Promise<void> {
  const { error } = await supabase().from("room_messages").delete().eq("id", id);
  if (error) throw error;
}

export async function reportRoomMessage(reporterId: string, messageId: string, reason: "uncomfortable" | "not_who_they_said" | "under_19" | "spam"): Promise<void> {
  const { error } = await supabase()
    .from("reports")
    .insert({ reporter_id: reporterId, target_kind: "message", target_room_message_id: messageId, reason });
  if (error) throw error;
}

export async function markSeen(roomId: string): Promise<void> {
  await supabase().rpc("room_seen", { p_room: roomId });
}

// The only write of a group message: called from the group's Send button (S29).
export async function sendGroupMessage(crewId: string, personId: string, body: string): Promise<void> {
  const { error } = await supabase().from("crew_messages").insert({ crew_id: crewId, author_id: personId, kind: "user", body: body.trim() });
  if (error) throw error;
}
