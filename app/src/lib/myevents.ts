// A19 — My Events (M3.2b). Everything read as the signed-in person, under RLS: their
// own pins (pins_read_own), the gatherings those are at (readable while published, and
// withdrawn ones you are pinned to), the groups they are in (in_group), and — for past
// rows only — A16's own after_state for whether they ticked "we met". No new database
// surface. The line each row says is packages/shared/src/myevents.ts.
import { isPast, MY_EVENTS_PINS_SELECT, type MyEventInput } from "@pind/shared";
import { SessionProblem, whoAmI } from "./session";
import { supabase } from "./supabase";

export interface MyEvent extends MyEventInput {
  gatheringId: string;
  slug: string;
  name: string;
  venue: string;
  timezone: string;
}

type PinRow = {
  gathering_id: string;
  open_to_meeting: boolean;
  gatherings: {
    slug: string | null;
    name: string;
    starts_at: string;
    ends_at: string | null;
    withdrawn_at: string | null;
    venues: { name: string; cities: { timezone: string } | null } | null;
  } | null;
};

export async function loadMyEvents(now = new Date()): Promise<MyEvent[]> {
  const db = supabase();
  const read = await whoAmI();
  if (read.state !== "in") throw new SessionProblem(read);
  const { data: me, error: meError } = await db.from("people").select("id").eq("auth_user_id", read.userId).maybeSingle();
  if (meError) throw meError;
  if (!me) return []; // signed in, never pinned

  const [pins, members] = await Promise.all([
    db
      .from("pins")
      .select(MY_EVENTS_PINS_SELECT)
      .eq("person_id", me.id),
    db.from("crew_members").select("crew_id, gathering_id").eq("person_id", me.id).is("left_at", null),
  ]);
  if (pins.error) throw pins.error;
  if (members.error) throw members.error;

  const crewIds = (members.data ?? []).map((m) => m.crew_id);
  const crews = crewIds.length
    ? await db.from("crews").select("id, gathering_id, state, meet_at, meeting_spots(name)").in("id", crewIds)
    : { data: [], error: null };
  if (crews.error) throw crews.error;
  const groupAt = new Map(
    (crews.data ?? []).map((c) => [
      c.gathering_id,
      { state: c.state, spot: (c.meeting_spots as { name: string } | null)?.name ?? null, meetAt: c.meet_at },
    ]),
  );

  // A pin whose gathering this person can no longer read (a draft again, say) is not
  // shown: there is nothing to open.
  const rows = ((pins.data ?? []) as unknown as PinRow[]).filter((p) => p.gatherings?.slug);
  return Promise.all(
    rows.map(async (p): Promise<MyEvent> => {
      const g = p.gatherings!;
      const base = {
        gatheringId: p.gathering_id,
        slug: g.slug!,
        name: g.name,
        venue: g.venues?.name ?? "",
        timezone: g.venues?.cities?.timezone ?? "America/Toronto",
        startsAt: g.starts_at,
        endsAt: g.ends_at,
        withdrawn: g.withdrawn_at !== null,
        openToMeeting: p.open_to_meeting,
        group: groupAt.get(p.gathering_id) ?? null,
        after: null as MyEventInput["after"],
      };
      if (!isPast(base, now)) return base;
      // Past: A16's own view of this night — your ticks, and whether they are still open.
      const { data } = await db.rpc("after_state", { p_gathering: p.gathering_id });
      const s = data as { open: boolean; people: { we_met: boolean }[] } | null;
      return { ...base, after: s ? { weMet: s.people.filter((x) => x.we_met).length, open: s.open } : null };
    }),
  );
}
