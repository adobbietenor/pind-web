// A20 / A29 / A22 — connections and their one chat (Alex, 16 Nov 2026).
//
// A connection is made by a yes to a 1-on-1, or by keeping in touch after the night (A16).
// Each connected pair has ONE chat, read and written only by its two (connection_messages'
// policies, P268/P311). It lasts as long as the connection; removing it, calling off the
// 1-on-1, blocking or reporting ends both, silently (P274, P308–P310). Every read here is as
// the signed-in person, and nothing filters people (H11).
import { supabase } from "./supabase";

// My chat with this person, or null when there is none for me (not connected, a block, hidden).
export async function connectionWith(personId: string): Promise<string | null> {
  const { data, error } = await supabase().rpc("connection_with", { p_other: personId });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export interface PairChat {
  connectionId: string;
  personId: string;
  firstName: string;
  photoPath: string | null;
  since: string;
}

// The chat's other person — only when the chat is mine (connection_chat).
export async function loadPairChat(connectionId: string): Promise<PairChat | null> {
  const { data, error } = await supabase().rpc("connection_chat", { p_connection: connectionId });
  if (error) throw error;
  const r = ((data ?? []) as { connection_id: string; person_id: string; first_name: string; photo_path: string | null; since: string }[])[0];
  return r ? { connectionId: r.connection_id, personId: r.person_id, firstName: r.first_name, photoPath: r.photo_path, since: r.since } : null;
}

// The 1-on-1 still on (or just done) between me and them, if any: the chat shows its event's
// optional place row, "I've arrived" on the night, and A17 after it.
export async function sharedOneOnOne(meId: string, personId: string): Promise<string | null> {
  const db = supabase();
  const { data: mine } = await db.from("crew_members").select("crew_id, crews(state, kind, created_at)").eq("person_id", meId).eq("kind", "solo").is("left_at", null);
  const rows = ((mine ?? []) as unknown as { crew_id: string; crews: { state: string; kind: string; created_at: string } | null }[])
    .filter((r) => r.crews && ["forming", "spot_set", "live", "done"].includes(r.crews.state))
    .sort((a, b) => (b.crews!.created_at > a.crews!.created_at ? 1 : -1));
  for (const r of rows) {
    const { data: other } = await db.from("crew_members").select("person_id").eq("crew_id", r.crew_id).eq("person_id", personId).is("left_at", null).maybeSingle();
    if (other) return r.crew_id;
  }
  return null;
}

// Either of you, any time: the chat ends for both, and a 1-on-1 still on is off. Silent.
export async function removeConnection(personId: string): Promise<void> {
  const { error } = await supabase().rpc("remove_connection", { p_other: personId });
  if (error) throw error;
}

// H9: mutual invisibility, never told. It also ends the connection and the chat.
export async function blockPerson(meId: string, personId: string): Promise<void> {
  const { error } = await supabase().from("blocks").insert({ blocker_id: meId, blocked_id: personId });
  if (error) throw error;
}

// What the chat shows of a 1-on-1 between the two of you: its event, its optional place and
// time, its state, and who has arrived on the night. Read through the group tables'
// member-only policies (V21).
export interface OneOnOneCard {
  crewId: string;
  state: "forming" | "spot_set" | "live" | "done" | "dissolved";
  gathering: { id: string; name: string; slug: string; startsAt: string; endsAt: string | null };
  spots: { id: string; name: string }[];
  plan: { spotId: string | null; atEvent: boolean; timeNote: string | null };
  arrived: Record<string, { at: string; note: string | null }>;
}

export async function loadOneOnOneCard(crewId: string): Promise<OneOnOneCard | null> {
  const db = supabase();
  const { data: c } = await db.from("crews").select("id, state, gathering_id, spot_id, at_event, time_note").eq("id", crewId).maybeSingle();
  if (!c) return null;
  const [g, mem] = await Promise.all([
    db.from("gatherings").select("id, name, slug, starts_at, ends_at, venue_id").eq("id", c.gathering_id).maybeSingle(),
    db.from("crew_members").select("person_id, arrived_at, arrival_note").eq("crew_id", crewId).is("left_at", null),
  ]);
  if (!g.data) return null;
  const spots = g.data.venue_id
    ? (await db.from("meeting_spots").select("id, name").eq("venue_id", g.data.venue_id).eq("active", true).order("name")).data ?? []
    : [];
  const arrived: OneOnOneCard["arrived"] = {};
  for (const m of mem.data ?? []) if (m.arrived_at) arrived[m.person_id] = { at: m.arrived_at, note: m.arrival_note };
  return {
    crewId,
    state: c.state as OneOnOneCard["state"],
    gathering: { id: g.data.id, name: g.data.name, slug: g.data.slug ?? g.data.id, startsAt: g.data.starts_at, endsAt: g.data.ends_at },
    spots,
    plan: { spotId: c.spot_id, atEvent: c.at_event, timeNote: c.time_note },
    arrived,
  };
}
