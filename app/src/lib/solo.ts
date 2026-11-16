// 1-on-1 (A9, A28, A29, A20), read and written as the signed-in person.
//
// Every read is a door the database opened on purpose: your own switch (my_solo), the
// people the rule lets you see (solo_people: can_see_solo), your requests as you may know
// them (my_solo_proposals — to a sender a declined request is a sent one), your 1-on-1
// through the group tables' member-only policies, your connections (my_connections). Nothing
// here filters people or decides who sees whom (H11). Every write is a function that checks
// again; a refusal comes back in words from packages/shared (soloRefusal), never "not allowed".
//
// Since build 23 (Alex, 16 Nov 2026) a request carries nothing, an accept makes the two of
// you connections with one chat (lib/connections.ts), and nothing asks for a place or time.
import { Platform } from "react-native";
import { houseClock, Said, soloRefusal, type Database } from "@pind/shared";
import { supabase } from "./supabase";

export type SoloChoice = Database["public"]["Enums"]["solo_visibility"];

async function said<T>(run: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await run;
  if (error) throw new Said(soloRefusal(error));
  return data;
}

// "Request to chat": no spot, no time, no line. Said yes, it is a chat.
export async function inviteSolo(gatheringId: string, to: string): Promise<void> {
  await said(supabase().rpc("propose_solo", { p_gathering: gatheringId, p_to: to, p_spot: null as unknown as string, p_meet_at: null as unknown as string, p_line: null as unknown as number }));
}

// Accept returns the 1-on-1's id; its chat is the pair's connection chat (connectionWith).
export async function answerSolo(proposalId: string, accept: boolean): Promise<string | null> {
  return (await said(supabase().rpc("respond_to_solo", { p_proposal: proposalId, p_accept: accept }))) as string | null;
}

export async function withdrawSolo(proposalId: string): Promise<void> {
  await said(supabase().rpc("withdraw_solo", { p_proposal: proposalId }));
}

// A time in the gathering's own zone: "7:30 pm".
export function soloClock(iso: string, tz: string): string {
  return houseClock(iso, tz);
}

// "Open to meeting people 1-on-1 at this event?": your own pin's switch, per event.
export async function myOneOnOne(gatheringId: string): Promise<{ on: boolean; audience: SoloChoice }> {
  const { data, error } = await supabase().rpc("my_solo", { p_gathering: gatheringId });
  if (error) throw error;
  const choice = (data as SoloChoice | null) ?? null;
  return { on: choice !== null, audience: choice ?? "everyone" };
}

export async function setOneOnOne(gatheringId: string, on: boolean, audience: SoloChoice): Promise<void> {
  await said(supabase().rpc("set_event_one_on_one", { p_gathering: gatheringId, p_on: on, p_audience: audience }));
}

// Who at this gathering is open to 1-on-1 with me (can_see_solo), and whom I've asked.
export async function soloHere(gatheringId: string): Promise<{ open: string[]; asked: string[] }> {
  const db = supabase();
  const [people, mine] = await Promise.all([
    db.rpc("solo_people", { p_gathering: gatheringId }),
    db.rpc("my_solo_proposals", { p_gathering: gatheringId }),
  ]);
  return {
    open: ((people.data ?? []) as { person_id: string }[]).map((r) => r.person_id),
    asked: ((mine.data ?? []) as { direction: string; person_id: string }[]).filter((r) => r.direction === "sent").map((r) => r.person_id),
  };
}

export interface SoloRequest {
  proposalId: string;
  gatheringId: string;
  gatheringName: string;
  slug: string;
  startsAt: string;
  personId: string;
  firstName: string;
  photoPath: string | null;
}

// Requests waiting for my answer, at every event not yet over (Connections, and filtered to
// one event on its crowd page).
export async function soloRequests(): Promise<SoloRequest[]> {
  const { data, error } = await supabase().rpc("my_solo_requests");
  if (error) throw error;
  return ((data ?? []) as { proposal_id: string; gathering_id: string; gathering_name: string; gathering_slug: string; starts_at: string; person_id: string; first_name: string; photo_path: string | null }[]).map((r) => ({
    proposalId: r.proposal_id,
    gatheringId: r.gathering_id,
    gatheringName: r.gathering_name,
    slug: r.gathering_slug,
    startsAt: r.starts_at,
    personId: r.person_id,
    firstName: r.first_name,
    photoPath: r.photo_path,
  }));
}

// Either of the two, no confirmation, never required: a curated spot, the event itself, or
// neither; a time in words.
export async function setSoloPlace(crewId: string, spotId: string | null, atEvent: boolean, timeNote: string): Promise<void> {
  await said(supabase().rpc("set_solo_place", { p_crew: crewId, p_spot: spotId as string, p_at_event: atEvent, p_time_note: timeNote }));
}

// What the crowd page and the person sheet need: all of it the viewer's own (my_solo here,
// my_solo_proposals, my own 1-on-1 membership, my connections) or the database's answer about
// the other person (solo_people), and the brake.
export interface SoloFacts {
  open: string[];
  asked: string[];
  mineOn: boolean;
  available: boolean;
  inPlan: boolean;
  // My 1-on-1 here, if I have one still on: who with, and our chat.
  plan: { crewId: string; personId: string; firstName: string; connectionId: string | null } | null;
  // Everyone I'm connected with, to their chat: the sheet offers "Message" instead of a request.
  connected: Record<string, string>;
}

export async function soloFacts(gatheringId: string, meId: string): Promise<SoloFacts> {
  const db = supabase();
  const [here, mine, brake, sw, plan, conns] = await Promise.all([
    soloHere(gatheringId),
    myOneOnOne(gatheringId),
    db.rpc("solo_available"),
    db.from("app_switches").select("ios, web").eq("name", "solo").maybeSingle(),
    db.from("crew_members").select("crew_id, crews(state)").eq("person_id", meId).eq("gathering_id", gatheringId).eq("kind", "solo").is("left_at", null),
    db.rpc("my_connections"),
  ]);
  const platformOn = sw.data ? (Platform.OS === "web" ? sw.data.web : sw.data.ios) : true;
  const rows = (plan.data ?? []) as unknown as { crew_id: string; crews: { state: string } | null }[];
  const on = rows.find((r) => ["forming", "spot_set", "live", "done"].includes(r.crews?.state ?? ""));
  const connected: Record<string, string> = {};
  for (const c of (conns.data ?? []) as { person_id: string; connection_id: string }[]) connected[c.person_id] = c.connection_id;
  let mine1: SoloFacts["plan"] = null;
  if (on) {
    const { data: other } = await db.from("crew_members").select("person_id, people(first_name)").eq("crew_id", on.crew_id).is("left_at", null).neq("person_id", meId).maybeSingle();
    const o = other as unknown as { person_id: string; people: { first_name: string } | null } | null;
    if (o) mine1 = { crewId: on.crew_id, personId: o.person_id, firstName: o.people?.first_name ?? "", connectionId: connected[o.person_id] ?? null };
  }
  return {
    ...here,
    mineOn: mine.on,
    available: brake.data !== false && platformOn,
    inPlan: !!on,
    plan: mine1,
    connected,
  };
}
