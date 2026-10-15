// Squads (M3.7; A9, A11, A15): what the screens read and the four things they do.
//
// **Nothing here decides who sees what** (H11). The list is `squads(G)`, which the
// database writes for the person asking: women-only inherited, blocks absent, unapproved
// names unlisted, full ones last. Joining is `join_squad`, which re-checks all of it at
// the moment of the tap. Every refusal is the database's, said in words (squadRefusal),
// never `.message` (S20).
import { Platform } from "react-native";
import { Said, squadRefusal } from "@pind/shared";
import { supabase } from "@/lib/supabase";
import { womenOnlyRooms } from "@/lib/after";

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";
const WORKER = Platform.OS === "web" ? "" : SITE;

export interface SquadCard {
  crewId: string;
  name: string;
  womenOnly: boolean;
  spot: string | null;
  meetAt: string;
  seats: number;
  full: boolean;
  members: { personId: string; firstName: string }[];
}

export interface MySquad {
  crewId: string;
  name: string;
  nameStatus: "pending" | "approved" | "rejected";
  state: string;
  spot: string | null;
  meetAt: string | null;
  womenOnly: boolean;
  mine: boolean; // I started it — the only one who can rename a name that did not pass
  legacy: boolean;
}

export interface SquadsView {
  tz: string;
  startsAt: string;
  endsAt: string | null;
  spots: { id: string; name: string }[];
  hasSpots: boolean;
  squads: SquadCard[];
  mine: MySquad | null;
  womenOnly: { eligible: boolean; only: boolean };
}

async function said<T>(run: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await run;
  if (error) throw new Said(squadRefusal(error));
  return data;
}

export async function loadSquads(gatheringId: string, meId: string): Promise<SquadsView> {
  const db = supabase();
  const [g, list, mem, wo] = await Promise.all([
    db.from("gatherings").select("starts_at, ends_at, venue_id, venues(cities(timezone))").eq("id", gatheringId).maybeSingle(),
    db.rpc("squads", { p_gathering: gatheringId }),
    db
      .from("crew_members")
      .select("crew_id, crews(name, name_status, state, meet_at, women_only, created_by, legacy, meeting_spots(name))")
      .eq("person_id", meId)
      .eq("gathering_id", gatheringId)
      .eq("kind", "crew")
      .is("left_at", null)
      .maybeSingle(),
    womenOnlyRooms(meId),
  ]);
  if (g.error) throw g.error;
  if (list.error) throw list.error;
  if (!g.data) throw new Said("This gathering is not on Pin'd any more.");
  const tz = (g.data as unknown as { venues: { cities: { timezone: string } | null } | null }).venues?.cities?.timezone ?? "America/Toronto";
  const { data: spots } = g.data.venue_id
    ? await db.from("meeting_spots").select("id, name").eq("venue_id", g.data.venue_id).eq("active", true).order("name")
    : { data: [] as { id: string; name: string }[] };
  type Row = { crew_id: string; name: string; women_only: boolean; spot: string | null; meet_at: string; seats: number; is_full: boolean; members: { person_id: string; first_name: string }[] };
  type Mem = { crew_id: string; crews: { name: string | null; name_status: MySquad["nameStatus"] | null; state: string; meet_at: string | null; women_only: boolean; created_by: string | null; legacy: boolean; meeting_spots: { name: string } | null } | null };
  const m = mem.data as unknown as Mem | null;
  return {
    tz,
    startsAt: g.data.starts_at,
    endsAt: g.data.ends_at,
    spots: spots ?? [],
    hasSpots: (spots ?? []).length > 0,
    squads: ((list.data ?? []) as unknown as Row[]).map((r) => ({
      crewId: r.crew_id,
      name: r.name,
      womenOnly: r.women_only,
      spot: r.spot,
      meetAt: r.meet_at,
      seats: r.seats,
      full: r.is_full,
      members: (r.members ?? []).map((x) => ({ personId: x.person_id, firstName: x.first_name })),
    })),
    mine:
      m && m.crews && m.crews.state !== "dissolved"
        ? {
            crewId: m.crew_id,
            name: m.crews.name ?? "",
            nameStatus: m.crews.name_status ?? "approved",
            state: m.crews.state,
            spot: m.crews.meeting_spots?.name ?? null,
            meetAt: m.crews.meet_at,
            womenOnly: m.crews.women_only,
            mine: m.crews.created_by === meId,
            legacy: m.crews.legacy,
          }
        : null,
    womenOnly: { eligible: wo.eligible, only: wo.eligible && wo.on },
  };
}

// The net under the webhook: ask the Worker to check the name now, so it is listed in
// seconds. Best effort — the webhook and the hourly sweep are the mechanism.
async function checkNameSoon(crewId: string): Promise<void> {
  try {
    const { data } = await supabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(`${WORKER}/squad-name-check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ crew_id: crewId }),
    });
  } catch {
    // The sweep picks it up within the hour.
  }
}

export async function startSquad(gatheringId: string, name: string, spotId: string | null, meetAt: string, womenOnly: boolean): Promise<string> {
  const id = (await said(
    supabase().rpc("start_squad", { p_gathering: gatheringId, p_name: name, p_spot: spotId as string, p_meet_at: meetAt, p_women_only: womenOnly }),
  )) as string;
  void checkNameSoon(id);
  return id;
}

export async function joinSquad(crewId: string): Promise<void> {
  await said(supabase().rpc("join_squad", { p_crew: crewId }));
}

export async function renameSquad(crewId: string, name: string): Promise<void> {
  await said(supabase().rpc("rename_squad", { p_crew: crewId, p_name: name }));
  void checkNameSoon(crewId);
}
