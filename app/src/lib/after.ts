// The night and after, read and written as the signed-in person (M3.3).
//
// Every function here is a door the database opened on purpose (V23, docs/visibility.md
// §12i): the ticks, the connections and the invites have no readable table. What comes
// back is what the database decided this person may know — "matched" is computed there,
// only from a tick of theirs, so nothing here can reveal a tick that was not returned.

import { readProfile } from "./profile";
import { supabase } from "./supabase";

export interface AfterPerson {
  personId: string;
  firstName: string;
  photoUrl: string | null;
  weMet: boolean;
  weMetMatched: boolean;
  keep: boolean;
  keepMatched: boolean;
}

export interface AfterView {
  gathering: { id: string; name: string; slug: string };
  ended: boolean;
  asked: boolean;
  answered: boolean;
  crewId: string | null;
  open: boolean;
  people: AfterPerson[];
}

async function signed(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data } = await supabase().storage.from("photos").createSignedUrls(paths, 300);
  return new Map((data ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl as string]));
}

export async function loadAfter(slug: string): Promise<AfterView | null> {
  const db = supabase();
  const { data: g, error } = await db.from("gatherings").select("id, name, slug").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!g) return null;
  const { data, error: e2 } = await db.rpc("after_state", { p_gathering: g.id });
  if (e2) throw e2;
  const s = data as {
    ended: boolean; asked: boolean; answered: boolean; crew_id: string | null; open: boolean;
    people: { person_id: string; first_name: string; photo_path: string | null; we_met: boolean; we_met_matched: boolean; keep: boolean; keep_matched: boolean }[];
  } | null;
  if (!s) return null;
  const urls = await signed(s.people.map((p) => p.photo_path).filter((x): x is string => !!x));
  return {
    gathering: { id: g.id, name: g.name, slug: g.slug ?? g.id },
    ended: s.ended,
    asked: s.asked,
    answered: s.answered,
    crewId: s.crew_id,
    open: s.open,
    people: s.people.map((p) => ({
      personId: p.person_id,
      firstName: p.first_name,
      photoUrl: p.photo_path ? urls.get(p.photo_path) ?? null : null,
      weMet: p.we_met,
      weMetMatched: p.we_met_matched,
      keep: p.keep,
      keepMatched: p.keep_matched,
    })),
  };
}

export async function tick(crewId: string, to: string, kind: "we_met" | "keep_in_touch", on: boolean): Promise<void> {
  const { error } = await supabase().rpc("after_tick", { p_crew: crewId, p_to: to, p_kind: kind, p_on: on });
  if (error) throw error;
}

// Who is answering is read fresh at the write, never taken from the screen (CLAUDE.md,
// "re-read who you are").
export async function answer(gatheringId: string, wouldHaveGone: "yes" | "no" | "wasnt_going"): Promise<void> {
  const me = await readProfile();
  if (!me.personId) throw new Error("not signed in");
  const { error } = await supabase()
    .from("survey_responses")
    .insert({ gathering_id: gatheringId, person_id: me.personId, would_have_gone: wouldHaveGone });
  if (error) throw error;
}

export interface Connection {
  personId: string;
  firstName: string;
  photoUrl: string | null;
  metAt: string | null;
}

export async function myConnections(): Promise<Connection[]> {
  const { data, error } = await supabase().rpc("my_connections");
  if (error) throw error;
  const rows = (data ?? []) as { person_id: string; first_name: string; photo_path: string | null; met_at: string | null }[];
  const urls = await signed(rows.map((r) => r.photo_path).filter((x): x is string => !!x));
  return rows.map((r) => ({ personId: r.person_id, firstName: r.first_name, photoUrl: r.photo_path ? urls.get(r.photo_path) ?? null : null, metAt: r.met_at }));
}

export interface InviteOption {
  gatheringId: string;
  name: string;
  startsAt: string;
  already: "going" | "invited" | null;
}

export async function inviteOptions(to: string): Promise<InviteOption[]> {
  const { data, error } = await supabase().rpc("invite_options", { p_to: to });
  if (error) throw error;
  return ((data ?? []) as { gathering_id: string; name: string; starts_at: string; already: "going" | "invited" | null }[]).map((o) => ({
    gatheringId: o.gathering_id,
    name: o.name,
    startsAt: o.starts_at,
    already: o.already,
  }));
}

export async function invite(to: string, gatheringId: string): Promise<void> {
  const { error } = await supabase().rpc("invite_connection", { p_to: to, p_gathering: gatheringId });
  if (error) throw error;
}

// "rate: five invites a day" — the database's words for the cap, told apart from any
// other refusal so the screen can say it where the tap was.
export const isFiveADay = (err: unknown) => /five invites a day/.test((err as { message?: string } | null)?.message ?? "");

// Women-only rooms only (Alex, 29 Sept): a real only.
export async function womenOnlyRooms(personId: string): Promise<{ eligible: boolean; on: boolean }> {
  const { data, error } = await supabase()
    .from("people_private")
    .select("gender, include_in_women_only, women_only_rooms")
    .eq("person_id", personId)
    .maybeSingle();
  if (error) throw error;
  const eligible = data?.gender === "woman" || (data?.gender === "nonbinary" && !!data?.include_in_women_only);
  return { eligible, on: !!data?.women_only_rooms };
}

export async function switchWomenOnlyRooms(on: boolean): Promise<void> {
  const { error } = await supabase().rpc("set_women_only_rooms", { p_on: on });
  if (error) throw error;
}

export async function waitingForWomenOnlyRoom(gatheringId: string): Promise<boolean> {
  const { data, error } = await supabase().rpc("waiting_for_women_only_room", { p_gathering: gatheringId });
  if (error) throw error;
  return !!data;
}

export async function joinGeneralRoom(gatheringId: string): Promise<void> {
  const { error } = await supabase().rpc("join_general_room", { p_gathering: gatheringId });
  if (error) throw error;
}
