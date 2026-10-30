// A20's "Requests" (UI pass 1, 077/095): what is waiting for an answer from me, one list
// for the screen and the tab's dot. 1-on-1 requests now; keep-in-touch requests join it with
// that change. Each source is the database's own (my_solo_requests: can_see_solo, open,
// before the start), so a request "Not now"-ed or closed is simply not in it.
import { soloRequests, type SoloRequest } from "./solo";

export const REQUESTS_KEY = ["requests"] as const;

export interface Requests {
  solo: SoloRequest[];
}

export async function loadRequests(): Promise<Requests> {
  const solo = await soloRequests().catch(() => [] as SoloRequest[]);
  return { solo };
}

export const requestCount = (r: Requests | undefined) => (r ? r.solo.length : 0);
