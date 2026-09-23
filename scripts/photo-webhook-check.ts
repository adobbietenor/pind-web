// Prove the whole photo-check chain, end to end (Phase 3 M3.1).
//
// Trigger → pg_net → the Worker → Anthropic → `photo_checks` → `people.photo_status`
// → `moderation_log` → the daily spend. Every link, in one command, against real
// staging. The equivalent of the admin's "Send a test alert": a key that is set is not
// a working channel, and the only way to know is to run the thing.
//
// Usage, from the repo root:
//   node --env-file=.dev.vars scripts/photo-webhook-check.ts
//
// It uses `app/assets/icon.png` as the photo on purpose. It is a real PNG and it is
// obviously not a face, so the honest verdict is `needs_review` — which proves the
// chain AND the rubric's caution in one call, for about half a cent.
//
// **It cleans up after itself**: the person row is deleted (which cascades the check
// rows) and the object is removed from the bucket, whether it passed or failed.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

function env(name: string): string {
  const value = (process.env[name] ?? process.env[`﻿${name}`])?.trim();
  if (!value) throw new Error(`${name} is missing from .dev.vars`);
  return value;
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function health() {
  const { data, error } = await db.rpc("admin_photo_webhook_health");
  if (error) throw new Error(`health: ${error.message}`);
  return (Array.isArray(data) ? data[0] : data) as {
    url: string | null;
    secret_set: boolean;
    secret_fingerprint: string | null;
    last_status: number | null;
    last_body: string | null;
    waiting: number;
  };
}

const path = `${randomUUID()}/webhook-check.png`;
let personId: string | null = null;

try {
  const before = await health();
  console.log(`url             ${before.url ?? "NOT SET"}`);
  console.log(`secret          ${before.secret_set ? `set · fingerprint ${before.secret_fingerprint}` : "NOT SET"}`);
  console.log("");

  const bytes = await readFile("app/assets/icon.png");
  const up = await db.storage.from("photos").upload(path, bytes, { contentType: "image/png" });
  if (up.error) throw new Error(`upload: ${up.error.message}`);

  const spentBefore = (await db.rpc("admin_ai_spend_today", { p_city: "toronto" })).data as number;

  const { data: person, error } = await db
    .from("people")
    .insert({ first_name: "Webhookcheck", photo_path: path })
    .select("id")
    .single();
  if (error) throw new Error(`insert: ${error.message}`);
  personId = person.id;
  console.log(`person ${personId} created with a photo — waiting for the check`);

  let checks: any[] = [];
  for (let i = 0; i < 20 && !checks.length; i++) {
    await sleep(3000);
    checks = (await db.from("photo_checks").select("*").eq("person_id", personId)).data ?? [];
    if (!checks.length) process.stdout.write(`  ${(i + 1) * 3}s…\r`);
  }
  console.log("");

  if (!checks.length) {
    // The chain broke, and the reply says where. `missing` is the trigger or pg_net;
    // `mismatch` is the two halves of the secret; a 404 is the URL; nothing at all is
    // pg_net never getting a reply.
    const after = await health();
    console.log(`NO CHECK after 60s.`);
    console.log(`  last reply:  ${after.last_status ?? "(none)"} ${after.last_body ?? ""}`);
    console.log(`  queued:      ${after.waiting}`);
    process.exitCode = 1;
  } else {
    for (const c of checks) {
      console.log(`${c.outcome.toUpperCase()} via ${c.source} — ${c.reason ?? c.error ?? ""}`);
      console.log(`  $${c.ai_cost_usd} · ${c.duration_ms}ms · ${c.model}`);
    }
    const status = (await db.from("people").select("photo_status").eq("id", personId).single()).data?.photo_status;
    const log = (await db.from("moderation_log").select("actor, action").eq("person_id", personId)).data;
    const spentAfter = (await db.rpc("admin_ai_spend_today", { p_city: "toronto" })).data as number;
    console.log(`  photo_status:   ${status}`);
    console.log(`  moderation_log: ${JSON.stringify(log)}`);
    console.log(`  spend today:    $${spentBefore} → $${spentAfter}`);
    console.log(`  photo states:   ${JSON.stringify((await db.rpc("admin_photo_states")).data)}`);
  }
} finally {
  if (personId) await db.from("people").delete().eq("id", personId);
  await db.storage.from("photos").remove([path]);
  console.log("cleaned up");
}
