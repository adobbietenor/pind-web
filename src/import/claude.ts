// Claude calls for the importer (Phase 1 M1.3): score drafts, suggest meeting spots.
// The Anthropic key is a Worker secret, used server-side only. Prompts, parsing and
// cost live in ai.ts; this file only makes the calls.
import Anthropic from "@anthropic-ai/sdk";
import {
  costUsd,
  MODEL,
  parseScores,
  parseSpots,
  SCORE_SCHEMA,
  SCORING_SYSTEM,
  scoringUserMessage,
  SPOTS_SYSTEM,
  SPOTS_TOOL,
  spotsUserMessage,
  type ScoreInput,
  type SpotIdea,
} from "./ai";

export function claudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
}

// One call for up to 25 drafts. A refusal, a cut-off answer or a malformed one scores
// nothing; those drafts stay unscored and are retried on the next run.
export async function scoreBatch(
  client: Anthropic,
  events: ScoreInput[],
): Promise<{ scores: Map<string, { score: number; reason: string }>; cost: number }> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SCORING_SYSTEM,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCORE_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [{ role: "user", content: scoringUserMessage(events) }],
  });
  const cost = costUsd(res.usage);
  if (res.stop_reason !== "end_turn") return { scores: new Map(), cost };
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { scores: parseScores(text, events.map((e) => e.id)), cost };
}

// Web search (at most 5 searches), then one propose_spots call. A long search can
// pause the turn; it is resumed by sending the paused turn back, at most 3 times.
export async function suggestSpots(
  client: Anthropic,
  venue: { name: string; address: string | null },
): Promise<{ spots: SpotIdea[]; cost: number }> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: spotsUserMessage(venue) }];
  let cost = 0;
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SPOTS_SYSTEM,
      output_config: { effort: "medium" },
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: 5,
          user_location: { type: "approximate", city: "Toronto", region: "Ontario", country: "CA", timezone: "America/Toronto" },
        },
        SPOTS_TOOL as unknown as Anthropic.Tool,
      ],
      messages,
    });
    cost += costUsd(res.usage);
    const call = res.content.find((b) => b.type === "tool_use" && b.name === SPOTS_TOOL.name);
    if (call && call.type === "tool_use") return { spots: parseSpots(call.input), cost };
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  return { spots: [], cost };
}
