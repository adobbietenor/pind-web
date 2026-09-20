// The liveness run (M2.3b): read a few series' own pages and record what they say.
//
// Its own cron, its own run row, its own budget line, and never inside the import
// (Alex). The import must not be delayed by somebody else's slow website, and a
// community run that stalls must not stop the city's list from refreshing.
//
// Staggered on purpose: the few least-recently-checked series a night, so each of the
// 28 comes round about weekly. **Measured on the first full pass, 20 Sept 2026: $0.42
// for all 28 pages — about 1.5 cents each, so four a night is six cents a day.** The
// cap is the whole day's, across every job (admin_ai_spend_today), so this cannot
// quietly eat the budget the nightly scoring needs.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLocal } from "../admin/time.ts";
import { canSpend, costUsd, MODEL } from "../import/ai.ts";
import type { Env } from "../env";
// With the extension, so this module — and therefore the whole job — can be loaded and
// run outside the Worker. That is how the first pass over all 28 series was measured
// before trusting it to a cron, and it is why map.ts and time.ts are written the same
// way: a module that only a deploy can execute is a module nobody checks.
import { serviceClient } from "../supabase.ts";
import {
  BLURB_SCHEMA,
  BLURB_SYSTEM,
  blurbUserMessage,
  CHECK_SCHEMA,
  CHECK_SYSTEM,
  checkUserMessage,
  excerpt,
  pageText,
  readAnswer,
  readBlurb,
  type Outcome,
  type SeriesRow,
} from "./series.ts";

export const CHECKER = "checker:community";

// The schedule this job answers to. One definition: src/index.ts picks the job by the
// expression that fired, and wrangler.jsonc has to carry the same string — an
// expression that drifts out of step would silently run the import twice a day and the
// check never.
export const LIVENESS_CRON = "0 13 * * *";

// Four a night gets through 28 series in a week. Bounded so one bad night cannot
// empty the budget, and so the run always finishes inside a cron invocation.
const PER_RUN = 4;
// The ceiling counted before a call, the way the scoring batch's is — deliberately
// above the measured 1.5 cents, because an estimate that runs under the real cost is
// how a cap stops being one.
const ESTIMATE_PER_PAGE = 0.05;
const FETCH_MS = 20_000;
const CALL_MS = 90_000;
const DEFAULT_CAP_USD = 3;
const TZ = "America/Toronto";

export interface CheckRunResult {
  status: "ok" | "partial" | "failed" | "busy";
  message: string;
}

// One page, fetched as a browser would ask for it. A page we cannot read is a state,
// not an error: it is recorded and the series is not judged on it.
async function fetchPage(url: string): Promise<{ ok: boolean; status: string; html: string; gone: boolean }> {
  try {
    const res = await fetch(url, {
      headers: {
        // Said plainly, with somewhere to complain to. A checker that lies about what
        // it is has no business reading somebody's page every week.
        "user-agent": "Mozilla/5.0 (compatible; PindBot/1.0; +https://pind.social/about)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const html = res.ok ? await res.text() : "";
    return { ok: res.ok, status: String(res.status), html, gone: res.status === 404 || res.status === 410 };
  } catch (err) {
    return { ok: false, status: err instanceof Error ? err.message.slice(0, 120) : "fetch failed", html: "", gone: false };
  }
}

// When this series next runs, in the venue's own words, so the model is asked about the
// right Tuesday rather than about a name.
async function whenItRuns(db: SupabaseClient, seriesId: string): Promise<string> {
  const { data } = await db
    .from("gatherings")
    .select("starts_at")
    .eq("series_id", seriesId)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(1);
  const rows = (data ?? []) as { starts_at: string }[];
  return rows.length === 0 ? "no upcoming dates in our records" : formatLocal(rows[0]!.starts_at, TZ);
}

// One line about a series, written from its own page, and applied to every occurrence
// that has none. Returns what it cost, so an aborted call is still counted against the
// day — a call that is billed and whose usage never arrives is M1.3b's cost blind spot.
async function describeSeries(
  db: SupabaseClient,
  claude: Anthropic,
  s: SeriesRow,
  html: string,
  onAbort: () => void,
): Promise<{ described: number; cost: number; error?: string }> {
  // Which occurrences still need one. If none do, there is nothing to pay for.
  const { data: rows, error } = await db
    .from("gatherings")
    .select("id, entry, door_price_cents, venues(name), starts_at")
    .eq("series_id", s.id)
    .is("blurb", null)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(400);
  if (error) return { described: 0, cost: 0, error: error.message };
  const needy = (rows ?? []) as any[];
  if (needy.length === 0) return { described: 0, cost: 0 };

  const first = needy[0]!;
  const entry =
    first.entry === "free"
      ? "free"
      : first.entry === "door"
        ? `pay at the door${first.door_price_cents ? ` ($${(first.door_price_cents / 100).toFixed(0)})` : ""}`
        : "ticketed";

  let cost = 0;
  try {
    const res = await claude.messages
      .stream(
        {
          model: MODEL,
          max_tokens: 700,
          system: BLURB_SYSTEM,
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: BLURB_SCHEMA as unknown as Record<string, unknown> },
          },
          messages: [
            {
              role: "user",
              content: blurbUserMessage(
                { label: s.label, venue: first.venues?.name ?? "unknown", when: formatLocal(first.starts_at, TZ), entry },
                excerpt(pageText(html), s.label, 14_000),
              ),
            },
          ],
        },
        { signal: AbortSignal.timeout(CALL_MS) },
      )
      .finalMessage();
    cost += costUsd(res.usage);
    const body = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
    const blurb = res.stop_reason === "end_turn" ? readBlurb(parsed) : null;
    if (!blurb) return { described: 0, cost };

    let described = 0;
    for (const g of needy) {
      const { data: wrote, error: writeError } = await db.rpc("admin_set_blurb", {
        p_gathering: g.id,
        p_blurb: blurb.what,
        p_why: blurb.why,
        p_source: "page",
        p_actor: CHECKER,
      });
      if (writeError) return { described, cost, error: writeError.message };
      if (wrote) described += 1;
    }
    return { described, cost };
  } catch (err) {
    onAbort();
    return { described: 0, cost, error: err instanceof Error ? err.message.slice(0, 120) : "the description call failed" };
  }
}

export async function runSeriesChecks(env: Env, opts: { trigger: "cron" | "manual"; actor: string }): Promise<CheckRunResult> {
  const db = serviceClient(env);
  const started = await db.rpc("admin_start_check_run", { p_trigger: opts.trigger, p_actor: opts.actor, p_city: "toronto" });
  if (started.error) {
    return /already going/.test(started.error.message)
      ? { status: "busy", message: "A liveness run is already going. Try again in a few minutes." }
      : { status: "failed", message: started.error.message };
  }
  const runId = started.data as number;
  const counts: Record<string, unknown> = { read: 0, confirmed: 0, absent: 0, gone: 0, unreadable: 0, described: 0 };
  const errors: string[] = [];
  let status: CheckRunResult["status"] = "ok";
  let cost = 0;

  try {
    // The credential check is inside the try and after the run row exists, so a night
    // that fails on a missing key leaves a failed run behind rather than nothing at all
    // (Alex, M2.2 — the rule the whole watchdog came out of).
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set on the Worker, so no series can be checked. Set it with `npx wrangler secret put ANTHROPIC_API_KEY`.",
      );
    }
    const claude = new Anthropic({ apiKey, maxRetries: 1, timeout: CALL_MS });
    const cap = Number(env.AI_DAILY_CAP_USD ?? DEFAULT_CAP_USD);
    const spentBefore = Number((await db.rpc("admin_ai_spend_today", { p_city: "toronto" })).data ?? 0);

    // Least recently checked first, nulls first: the 28 that have never been read get
    // read before anything is re-read.
    const { data, error } = await db
      .from("community_series")
      .select("*")
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(PER_RUN);
    if (error) throw new Error(error.message);
    const series = (data ?? []) as SeriesRow[];

    const today = new Date().toISOString().slice(0, 10);
    for (const s of series) {
      if (!canSpend(spentBefore + cost, ESTIMATE_PER_PAGE, cap)) {
        errors.push(`Stopped at the daily AI cap of $${cap.toFixed(2)}; ${series.length - (counts.read as number)} series left for tomorrow`);
        status = "partial";
        break;
      }

      const page = await fetchPage(s.url);
      let outcome: Outcome;
      let confirmedThrough: string | null = null;
      let cadence: string | null = null;
      let note: string;

      if (page.gone) {
        // The one unambiguous answer, and it needs no model.
        outcome = "gone";
        note = `The page answers ${page.status}.`;
      } else if (!page.ok) {
        outcome = "unreadable";
        note = `Could not read the page: ${page.status}.`;
      } else {
        const when = await whenItRuns(db, s.id);
        const text = excerpt(pageText(page.html), s.label);
        try {
          const res = await claude.messages
            .stream(
              {
                model: MODEL,
                max_tokens: 1000,
                system: CHECK_SYSTEM,
                output_config: {
                  effort: "low",
                  format: { type: "json_schema", schema: CHECK_SCHEMA as unknown as Record<string, unknown> },
                },
                messages: [{ role: "user", content: checkUserMessage({ label: s.label, url: s.url, when }, text) }],
              },
              { signal: AbortSignal.timeout(CALL_MS) },
            )
            .finalMessage();
          cost += costUsd(res.usage);
          const body = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = null;
          }
          const answer = res.stop_reason === "end_turn" ? readAnswer(parsed, today) : null;
          if (answer) {
            outcome = answer.outcome;
            confirmedThrough = answer.confirmedThrough;
            cadence = answer.cadence;
            note = answer.note;
          } else {
            // A call that came back unusable is not evidence about the gathering.
            outcome = "unreadable";
            note = "The check did not come back with a usable answer.";
          }
        } catch (err) {
          // Nor is a call that failed. An aborted call is still billed and its usage
          // never arrives, so an estimate is counted for it — M1.3b's cost blind spot,
          // which is only a blind spot if nobody writes it down (decisions Part 5).
          cost += ESTIMATE_PER_PAGE;
          outcome = "unreadable";
          note = `The check failed: ${err instanceof Error ? err.message.slice(0, 120) : "unknown error"}`;
          status = "partial";
        }
      }

      const { error: writeError } = await db.rpc("admin_record_series_check", {
        p_series: s.id,
        p_outcome: outcome,
        p_confirmed_through: confirmedThrough,
        p_cadence: cadence,
        p_status: page.gone ? "gone" : page.status,
        p_note: note,
      });
      if (writeError) {
        errors.push(`Could not record ${s.label}: ${writeError.message}`);
        status = "partial";
      }
      counts.read = (counts.read as number) + 1;
      counts[outcome] = ((counts[outcome] as number) ?? 0) + 1;

      // While the page is in hand and confirmed: a line for the reader, for the
      // occurrences of this series that have none. **Once per series, ever** — a line
      // is set once and never overwritten by a machine, so this stops happening as soon
      // as it has happened, and a page that knew nothing writes nothing at all.
      if (outcome === "confirmed" && page.ok) {
        const wrote = await describeSeries(db, claude, s, page.html, () => {
          cost += ESTIMATE_PER_PAGE;
        });
        cost += wrote.cost;
        if (wrote.described) counts.described = (counts.described as number) + wrote.described;
        if (wrote.error) {
          errors.push(`Could not describe ${s.label}: ${wrote.error}`);
          status = "partial";
        }
      }
    }
  } catch (err) {
    status = "failed";
    errors.push(err instanceof Error ? err.message : String(err));
  }

  counts.errors = errors;
  await db
    .from("community_check_runs")
    .update({ status, counts, ai_cost_usd: cost.toFixed(6), finished_at: new Date().toISOString(), error: errors[0] ?? null })
    .eq("id", runId);

  const message =
    status === "failed"
      ? `Liveness run failed: ${errors[0]}`
      : `Checked ${counts.read} series: ${counts.confirmed} confirmed, ${counts.absent} not on their page, ${counts.gone} page gone, ${counts.unreadable} could not tell. AI $${cost.toFixed(2)}.`;
  return { status, message };
}
