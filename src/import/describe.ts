// A line for the reader on an Events row (M2.3c, Alex: "'Toronto Tempo vs New York
// Liberty' tells a reader nothing — is it basketball, is it a season opener?").
//
// **Measured on 40 real published rows before this shipped**, as Alex asked, because the
// community numbers do not transfer — an organiser's page is written by somebody who
// cares, and a Ticketmaster row is a title and a venue:
//
//   32 of 40 recognised (80%), at $0.0012 a row
//   the 8 it declined were local DJ and support acts — exactly the rows to decline
//   0 refused by the stale guard, 0 too short to say anything
//
// What it produces: "NHL hockey, Toronto Maple Leafs hosting the Montreal Canadiens /
// A storied Original Six rivalry matchup", "MLB baseball, Toronto Blue Jays hosting the
// Cincinnati Reds / Fan Appreciation Weekend game late in the season", "Foster The
// People, indie pop rock band known for 'Pumped Up Kicks'".
//
// **Ticketmaster's own description is never read or stored.** Their terms keep us to
// event facts (decisions Part 5), so the only source here is what the model already
// knows about the act, the team or the show, plus the facts we hold. Which is also why
// the prompt spends most of its words on declining: the failure mode is a confident
// line about a band nobody has heard of.

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BLURB_FIELDS, readBlurb } from "../blurb.ts";
import { costUsd, MODEL } from "./ai.ts";
import { formatLocal } from "../admin/time.ts";
import { readerFloor } from "../public/list.ts";

export const DESCRIBE_SYSTEM = `You write one short line about a public event, for a reader deciding whether to go.

You are given only facts we hold: the name, the venue, the date and time, what it is filed under, and what it costs to walk in. There is no description — you are working from what you already know about this act, team or show.

For each event write:
- what_it_is: at most 110 characters, plain and concrete. What kind of thing is this, for somebody who does not recognise the name? "WNBA basketball, Toronto's expansion team" tells a reader more than "a sporting event".
- why_this_one: at most 150 characters, or null. Anything that makes THIS one worth turning up to — a season opener, a farewell tour, a debut in the city, a rivalry, a support act worth arriving early for. Null unless you are sure.

Rules that matter more than being helpful:
- **Only what you actually know.** Set known to false when you do not recognise this specific act, team or show. Do not describe the venue instead, and do not restate the title in other words: "a late-night themed dance party at a music venue" is a restatement and is worth nothing to a reader.
- **Never guess** a genre, a line-up, an anniversary, a reputation or a tour name. An invented detail sends somebody across a city on our word.
- **Never write anything that goes stale**: no tickets left, no "selling fast", no "this week only", no month or season.
- **Never write about the crowd, the meet-up, or who else is going.** That is our own page's job.
- No exclamation marks, no second person.

Answer with JSON only, one entry per event id.`;

const DESCRIBE_SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, ...BLURB_FIELDS }, required: ["id", "known", "what_it_is", "why_this_one"], additionalProperties: false },
    },
  },
  required: ["lines"],
  additionalProperties: false,
} as const;

const BATCH = 20;
// About 2.5 cents a batch at the measured rate; the ceiling counted before the call.
const ESTIMATE_PER_BATCH = 0.06;
const CALL_MS = 120_000;
const TZ = "America/Toronto";

export interface DescribeResult {
  considered: number;
  described: number;
  declined: number;
  cost: number;
  errors: string[];
}

// Everything a reader could reach soon and that has no line yet: published rows, and
// drafts inside the publisher's own lead window — the set the publisher is choosing
// from, so a line is ready the moment one of them is picked. A draft that never
// publishes has cost a tenth of a cent.
export async function describeEvents(
  db: SupabaseClient,
  claude: Anthropic,
  opts: { leadDaysMax: number; limit: number; canSpend: (estimate: number) => boolean },
): Promise<DescribeResult> {
  const out: DescribeResult = { considered: 0, described: 0, declined: 0, cost: 0, errors: [] };
  const now = new Date();
  const { data, error } = await db
    .from("gatherings")
    .select("id, name, starts_at, entry, slug, venues(name), gathering_sources(snapshot)")
    .eq("source", "ticketmaster")
    .eq("is_seed", false)
    .is("blurb", null)
    .is("dismissed_at", null)
    // **The floor the page uses, not "now"** (src/public/list.ts, readerFloor). W1 opens
    // on the start of today in the city, so a gathering starting this evening is on the
    // list all day; starting at `now` skipped exactly the rows a reader is looking at,
    // including the Toronto Tempo game Alex named. One definition, three jobs.
    .gte("starts_at", readerFloor(now, TZ).toISOString())
    .lte("starts_at", new Date(now.getTime() + opts.leadDaysMax * 86_400_000).toISOString())
    // Published first: those are the pages a stranger can open today.
    .order("slug", { nullsFirst: false })
    .order("starts_at")
    .limit(opts.limit);
  if (error) {
    out.errors.push(error.message);
    return out;
  }
  const rows = (data ?? []) as any[];
  out.considered = rows.length;
  if (rows.length === 0) return out;

  for (let i = 0; i < rows.length; i += BATCH) {
    if (!opts.canSpend(ESTIMATE_PER_BATCH)) {
      out.errors.push(`Stopped at the daily AI cap with ${rows.length - i} rows left to describe`);
      break;
    }
    const batch = rows.slice(i, i + BATCH);
    try {
      const res = await claude.messages
        .stream(
          {
            model: MODEL,
            max_tokens: 4000,
            system: DESCRIBE_SYSTEM,
            output_config: {
              effort: "low",
              format: { type: "json_schema", schema: DESCRIBE_SCHEMA as unknown as Record<string, unknown> },
            },
            messages: [
              {
                role: "user",
                content: JSON.stringify(
                  {
                    events: batch.map((r) => ({
                      id: r.id,
                      name: r.name,
                      venue: r.venues?.name ?? "unknown",
                      when: formatLocal(r.starts_at, TZ),
                      filed_under: (r.gathering_sources ?? []).map((s: any) => s?.snapshot?.category).find(Boolean) ?? "not classified",
                      entry: r.entry,
                    })),
                  },
                  null,
                  1,
                ),
              },
            ],
          },
          { signal: AbortSignal.timeout(CALL_MS) },
        )
        .finalMessage();
      out.cost += costUsd(res.usage);
      if (res.stop_reason !== "end_turn") {
        out.errors.push("A batch came back unfinished");
        continue;
      }
      let parsed: any = null;
      try {
        parsed = JSON.parse(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
      } catch {
        out.errors.push("A batch came back unparseable");
        continue;
      }
      const lines: any[] = Array.isArray(parsed?.lines) ? parsed.lines : [];
      const want = new Set(batch.map((r) => r.id));
      for (const line of lines) {
        if (typeof line?.id !== "string" || !want.has(line.id)) continue;
        const blurb = readBlurb(line);
        if (!blurb) {
          out.declined += 1;
          continue;
        }
        const { data: wrote, error: writeError } = await db.rpc("admin_set_blurb", {
          p_gathering: line.id,
          p_blurb: blurb.what,
          p_why: blurb.why,
          p_source: "knowledge",
          p_actor: "importer:ticketmaster",
        });
        if (writeError) out.errors.push(`Could not save a line: ${writeError.message}`);
        else if (wrote) out.described += 1;
      }
    } catch (err) {
      // Billed and its usage never arrives, so an estimate is counted for it — M1.3b's
      // cost blind spot, which is only blind if nobody writes it down.
      out.cost += ESTIMATE_PER_BATCH;
      out.errors.push(`A batch failed: ${err instanceof Error ? err.message.slice(0, 120) : "unknown error"}`);
    }
  }
  return out;
}
