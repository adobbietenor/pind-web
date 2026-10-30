// A9's night-of "I'm here" (UI pass 1): the three database functions, nothing else. Who
// sees what is decided there (here_now: a count to anyone pinned; people and their lines
// only to those who share a room or squad with you).
import { supabase } from "./supabase";

export interface HereNow {
  count: number;
  me: string | null;
  people: { personId: string; firstName: string; note: string }[];
}

export async function hereNow(gatheringId: string): Promise<HereNow> {
  const { data, error } = await supabase().rpc("here_now", { p_gathering: gatheringId });
  if (error) throw error;
  const d = (data ?? {}) as { count?: number; me?: string | null; people?: { person_id: string; first_name: string; note: string }[] };
  return {
    count: Number(d.count ?? 0),
    me: d.me ?? null,
    people: (d.people ?? []).map((p) => ({ personId: p.person_id, firstName: p.first_name, note: p.note })),
  };
}

// A refusal carries the database's hint (here_note, here_window, here_not_open).
export class HereRefused extends Error {
  constructor(readonly hint: string | undefined) {
    super("refused");
  }
}

export async function setHere(gatheringId: string, note: string): Promise<void> {
  const { error } = await supabase().rpc("set_here", { p_gathering: gatheringId, p_note: note });
  if (error) throw (error as { hint?: string }).hint ? new HereRefused((error as { hint?: string }).hint) : error;
}

export async function clearHere(gatheringId: string): Promise<void> {
  const { error } = await supabase().rpc("clear_here", { p_gathering: gatheringId });
  if (error) throw error;
}
