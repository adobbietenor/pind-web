// 1-on-1 (A28, A29; M3.4), read and written as the signed-in person.
//
// Every read is a door the database opened on purpose: your own switch (my_solo), the
// people the rule lets you see (solo_people), your proposals as you may know them
// (my_solo_proposals — to a sender a declined proposal is a sent one), your plan through
// the group tables' member-only policies. Nothing here filters people or decides who
// sees whom (H11). Every write is a function that checks again; a refusal comes back in
// words from packages/shared (soloRefusal), never "not allowed".
import { Platform } from "react-native";
import { houseClock, Said, soloRefusal, type Database } from "@pind/shared";
import { supabase } from "./supabase";

export type SoloChoice = Database["public"]["Enums"]["solo_visibility"];

export interface SoloProposal {
  id: string;
  personId: string;
  firstName: string;
  // Null for "Let's meet up!" (#17): an invite names no spot or time.
  spot: string | null;
  meetAt: string | null;
  line: number | null;
}

export interface SoloView {
  // The brake pulled (the database's, which also empties every list), off on this platform
  // (the admin's cosmetic switch), or no meeting spots: no 1-on-1 here.
  offered: boolean;
  choice: SoloChoice | null;
  startsAt: string;
  endsAt: string | null;
  tz: string;
  spots: { id: string; name: string }[];
  plan: { crewId: string; partner: string; spot: string | null; meetAt: string | null; state: string } | null;
  // Your group's plan here, if it has one — shown on the proposal sheet (decisions).
  group: { spot: string | null; meetAt: string | null } | null;
  people: string[];
  received: SoloProposal[];
  sent: SoloProposal[];
}

export async function loadSolo(gatheringId: string, meId: string): Promise<SoloView> {
  const db = supabase();
  const [g, sw, choice, available] = await Promise.all([
    db.from("gatherings").select("starts_at, ends_at, venue_id, venues(cities(timezone))").eq("id", gatheringId).maybeSingle(),
    db.from("app_switches").select("ios, web").eq("name", "solo").maybeSingle(),
    db.rpc("my_solo", { p_gathering: gatheringId }),
    db.rpc("solo_available"),
  ]);
  if (g.error) throw g.error;
  if (!g.data) throw new Said("This gathering is not on Pin'd any more.");
  const tz = (g.data as unknown as { venues: { cities: { timezone: string } | null } | null }).venues?.cities?.timezone ?? "America/Toronto";
  const platformOn = sw.data ? (Platform.OS === "web" ? sw.data.web : sw.data.ios) : true;
  const { data: spots } = g.data.venue_id
    ? await db.from("meeting_spots").select("id, name").eq("venue_id", g.data.venue_id).eq("active", true).order("name")
    : { data: [] as { id: string; name: string }[] };
  const base = {
    offered: available.data !== false && platformOn && (spots ?? []).length > 0,
    choice: (choice.data as SoloChoice | null) ?? null,
    startsAt: g.data.starts_at,
    endsAt: g.data.ends_at,
    tz,
    spots: spots ?? [],
  };
  if (!base.choice) return { ...base, plan: null, group: null, people: [], received: [], sent: [] };

  const [mem, people, props] = await Promise.all([
    db.from("crew_members").select("crew_id, kind, crews(state, meet_at, meeting_spots(name))").eq("person_id", meId).eq("gathering_id", gatheringId).is("left_at", null),
    db.rpc("solo_people", { p_gathering: gatheringId }),
    db.rpc("my_solo_proposals", { p_gathering: gatheringId }),
  ]);
  type Mem = { crew_id: string; kind: string; crews: { state: string; meet_at: string | null; meeting_spots: { name: string } | null } | null };
  const rows = (mem.data ?? []) as unknown as Mem[];
  const soloRow = rows.find((r) => r.kind === "solo");
  const groupRow = rows.find((r) => r.kind === "crew");
  let plan: SoloView["plan"] = null;
  if (soloRow) {
    const { data: partner } = await db.from("crew_members").select("person_id, people(first_name)").eq("crew_id", soloRow.crew_id).is("left_at", null).neq("person_id", meId).maybeSingle();
    plan = {
      crewId: soloRow.crew_id,
      partner: (partner as unknown as { people: { first_name: string } | null } | null)?.people?.first_name ?? "",
      spot: soloRow.crews?.meeting_spots?.name ?? null,
      meetAt: soloRow.crews?.meet_at ?? null,
      state: soloRow.crews?.state ?? "spot_set",
    };
  }
  const group = groupRow && groupRow.crews?.meet_at ? { spot: groupRow.crews.meeting_spots?.name ?? null, meetAt: groupRow.crews.meet_at } : null;
  const all = ((props.data ?? []) as { proposal_id: string; direction: string; person_id: string; first_name: string; spot_name: string | null; meet_at: string | null; line: number | null }[]).map((p) => ({
    direction: p.direction,
    p: { id: p.proposal_id, personId: p.person_id, firstName: p.first_name, spot: p.spot_name, meetAt: p.meet_at, line: p.line },
  }));
  return {
    ...base,
    plan,
    group,
    people: ((people.data ?? []) as { person_id: string }[]).map((r) => r.person_id),
    received: all.filter((x) => x.direction === "received").map((x) => x.p),
    sent: all.filter((x) => x.direction === "sent").map((x) => x.p),
  };
}

async function said<T>(run: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await run;
  if (error) throw new Said(soloRefusal(error));
  return data;
}

// The switch (A28): on only with a choice; off forgets the choice, so on asks again.
export async function setSolo(pinId: string, choice: SoloChoice | null): Promise<void> {
  await said(supabase().from("pins").update(choice ? { solo_opt_in: true, solo_visibility: choice } : { solo_opt_in: false }).eq("id", pinId).select("id"));
}

export async function proposeSolo(gatheringId: string, to: string, spotId: string, meetAt: string, line: number): Promise<void> {
  await said(supabase().rpc("propose_solo", { p_gathering: gatheringId, p_to: to, p_spot: spotId, p_meet_at: meetAt, p_line: line }));
}

// "Let's meet up!" (#17): an invite with no spot and no time. Said yes, it is a pair.
export async function inviteSolo(gatheringId: string, to: string): Promise<void> {
  await said(supabase().rpc("propose_solo", { p_gathering: gatheringId, p_to: to, p_spot: null as unknown as string, p_meet_at: null as unknown as string, p_line: null as unknown as number }));
}

// A pair's one pending spot (#17): suggested by either, a plan only on the other's yes.
export interface PairSuggestion {
  spotId: string;
  spot: string;
  meetAt: string;
  mine: boolean;
}

export async function loadPairSuggestion(crewId: string, meId: string): Promise<PairSuggestion | null> {
  const { data, error } = await supabase().from("solo_spot_suggestions").select("spot_id, meet_at, suggested_by, meeting_spots(name)").eq("crew_id", crewId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const d = data as unknown as { spot_id: string; meet_at: string; suggested_by: string; meeting_spots: { name: string } | null };
  return { spotId: d.spot_id, spot: d.meeting_spots?.name ?? "", meetAt: d.meet_at, mine: d.suggested_by === meId };
}

// What a pair picks from: the venue's curated spots, and the gathering's times and zone.
export async function loadPairOptions(gatheringId: string): Promise<{ spots: { id: string; name: string }[]; tz: string; startsAt: string; endsAt: string | null }> {
  const db = supabase();
  const { data: g, error } = await db.from("gatherings").select("starts_at, ends_at, venue_id, venues(cities(timezone))").eq("id", gatheringId).maybeSingle();
  if (error) throw error;
  if (!g) throw new Said("This gathering is not on Pin'd any more.");
  const tz = (g as unknown as { venues: { cities: { timezone: string } | null } | null }).venues?.cities?.timezone ?? "America/Toronto";
  const { data: spots } = g.venue_id
    ? await db.from("meeting_spots").select("id, name").eq("venue_id", g.venue_id).eq("active", true).order("name")
    : { data: [] as { id: string; name: string }[] };
  return { spots: spots ?? [], tz, startsAt: g.starts_at, endsAt: g.ends_at };
}

export async function suggestSpot(crewId: string, spotId: string, meetAt: string): Promise<void> {
  await said(supabase().rpc("suggest_solo_spot", { p_crew: crewId, p_spot: spotId, p_meet_at: meetAt }));
}

export async function confirmSpot(crewId: string): Promise<void> {
  await said(supabase().rpc("confirm_solo_spot", { p_crew: crewId }));
}

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

// A23: where 1-on-1 is on, and who can see you there — a summary only; it is switched on
// each gathering's crowd page (spec A23). Read through the export's own door.
export async function mySoloSummary(): Promise<{ name: string; womenOnly: boolean }[]> {
  const db = supabase();
  const { data, error } = await db.rpc("my_solo_export");
  if (error) throw error;
  const on = ((data as { settings: { gathering_id: string; who_can_see_you: SoloChoice }[] } | null)?.settings ?? []);
  if (!on.length) return [];
  const { data: gs } = await db.from("gatherings").select("id, name, starts_at").in("id", on.map((s) => s.gathering_id)).order("starts_at");
  return (gs ?? []).map((g) => ({ name: g.name, womenOnly: on.find((s) => s.gathering_id === g.id)?.who_can_see_you === "women_only" }));
}

// ---------------------------------------------------------------------------
// UI pass 1 (A28/A29/A20): the account switch, Requests, the chat's place and time.
// Every rule is the database's (set_one_on_one, can_see_solo, set_solo_place); these
// only ask.
// ---------------------------------------------------------------------------

export async function myOneOnOne(): Promise<{ on: boolean; audience: SoloChoice }> {
  const { data, error } = await supabase().rpc("my_one_on_one");
  if (error) throw error;
  const d = (data ?? {}) as { on?: boolean; audience?: SoloChoice };
  return { on: d.on === true, audience: d.audience ?? "everyone" };
}

export async function setOneOnOne(on: boolean, audience: SoloChoice): Promise<void> {
  await said(supabase().rpc("set_one_on_one", { p_on: on, p_audience: audience }));
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
  gatheringName: string;
  slug: string;
  startsAt: string;
  personId: string;
  firstName: string;
  photoPath: string | null;
}

export async function soloRequests(): Promise<SoloRequest[]> {
  const { data, error } = await supabase().rpc("my_solo_requests");
  if (error) throw error;
  return ((data ?? []) as { proposal_id: string; gathering_name: string; gathering_slug: string; starts_at: string; person_id: string; first_name: string; photo_path: string | null }[]).map((r) => ({
    proposalId: r.proposal_id,
    gatheringName: r.gathering_name,
    slug: r.gathering_slug,
    startsAt: r.starts_at,
    personId: r.person_id,
    firstName: r.first_name,
    photoPath: r.photo_path,
  }));
}

// Either of the two, no confirmation (UI pass 1): a curated spot, the event itself, or
// neither; a time in words.
export async function setSoloPlace(crewId: string, spotId: string | null, atEvent: boolean, timeNote: string): Promise<void> {
  await said(supabase().rpc("set_solo_place", { p_crew: crewId, p_spot: spotId as string, p_at_event: atEvent, p_time_note: timeNote }));
}
