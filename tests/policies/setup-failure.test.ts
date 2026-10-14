// P204 — a run whose setup throws leaves nothing behind (14 Oct 2026).
//
// **Why.** On 14 Oct the gateway answered 502 half-way through building the world: every
// case was cancelled, and what the half-built world had already created was left to
// whatever ran next. That is the shape of the 979 people rows with no account that broke
// the photo sweep (P184), arrived at from the other side: not a test that forgot its
// clean-up, but a setup that never reached the point where clean-up was registered.
//
// buildWorld sweeps when its setup throws, and policies.test.ts's `after` no longer skips
// itself when there is no world. This makes the setup throw, on purpose, once the cast
// exists, and insists the harness's own markers find nothing afterwards.
//
// **Its firing proof:** `PIND_P204_FIRE=1` makes buildWorld skip that clean-up, and P204
// must then fail, naming what was left (followed by a normal run, whose opening sweep
// removes it).
import { it } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "./env.ts";
import { accountlessPeople, buildWorld, harnessLeftovers, newClient, sweep } from "./world.ts";

it("P204 a setup that throws half-way through leaves no people, accounts, gatherings or venues behind", { timeout: 300_000 }, async () => {
  const env = loadEnv();
  const service = newClient(env, env.secretKey);
  // Start from nothing of ours, so whatever is found afterwards was left by this setup.
  await sweep(service);
  const accountlessBefore = await accountlessPeople(service);

  await assert.rejects(buildWorld(env, { failAfter: "cast" }), /P204: injected setup failure after the cast/, "the setup did not fail where it was told to");

  const left = await harnessLeftovers(service);
  const accountless = await accountlessPeople(service);
  assert.deepEqual(left, { people: 0, gatherings: 0, venues: 0, users: 0 }, `a failed setup left harness rows behind: ${JSON.stringify(left)}`);
  assert.ok(accountless <= accountlessBefore, `a failed setup left ${accountless - accountlessBefore} person rows with no account behind`);
});
