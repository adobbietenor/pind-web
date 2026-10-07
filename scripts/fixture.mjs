// Fixtures the browser checks stand on, checked before the walk — so a check that fails
// because its ground moved says so in a sentence, and never looks like a product bug.
//
// Alex, 6 Oct 2026: the test crowd finished on 2 Oct, moved only when someone pressed
// "Refresh", and every link-path walk failed at "A26 opens" for days with nothing saying
// why. "So a future failure never again looks like a product bug for three weeks."
//
// Every problem here prints one line that starts `FIXTURE, not product:` and exits 2
// (a product failure exits 1), naming what moved and how to put it back.
import { existsSync } from "node:fs";
import { seal } from "../src/public/sealed.ts";

export const TEST_CROWD = "Test crowd — walk the list";

export function fixture(sentence) {
  console.log(`FIXTURE, not product: ${sentence}`);
  process.exit(2);
}

// The keys a check reads from .dev.vars.
export function needEnv(...names) {
  const missing = names.filter((n) => !process.env[n]?.trim());
  if (missing.length) fixture(`${missing.join(", ")} missing from .dev.vars — run the check with node --env-file=.dev.vars (npm run check:… does).`);
}

export function needChrome(path) {
  if (!existsSync(path)) fixture(`Chrome is not at ${path} — install it, or set CHROME to where it is.`);
}

const base = () => process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const S = () => ({ apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` });

// The test crowd. `pinnable`: the walk pins to it, so it must not have started (pinning
// closes at the effective end; an hour's margin covers a long walk). The daily 09:00 run
// keeps it at least two days out (src/admin/testcrowd.ts, keepTestCrowdAhead).
export async function testCrowd({ pinnable }) {
  const res = await fetch(`${base()}/rest/v1/gatherings?name=eq.${encodeURIComponent(TEST_CROWD)}&is_seed=eq.true&select=id,slug,starts_at,venue_id,withdrawn_at`, { headers: S() });
  if (!res.ok) fixture(`could not read the test crowd from pind-staging (${res.status}) — is SUPABASE_SERVICE_ROLE_KEY in .dev.vars staging's?`);
  const [crowd] = await res.json();
  if (!crowd) fixture("there is no test crowd — build it on /admin/testers.");
  if (crowd.withdrawn_at) fixture("the test crowd is withdrawn — refresh it on /admin/testers.");
  if (pinnable && Date.parse(crowd.starts_at) < Date.now() + 60 * 60_000) {
    fixture(`the test crowd starts ${crowd.starts_at} — it has finished or is about to, so pinning to it is closed. Refresh it on /admin/testers; the daily 09:00 run keeps it two days ahead, so if this recurs, that job has stopped.`);
  }
  return crowd;
}

// The Worker opens the sealed hand-off with its own SESSION_SECRET. If .dev.vars holds a
// different one, every claim comes back empty (204) and the page simply never signs in —
// exactly what a broken hand-off looks like. So: seal a throwaway anonymous session with
// ours and ask the live Worker to open it.
export async function sessionSecretMatches(site) {
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
  const signup = await fetch(`${base()}/auth/v1/signup`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ data: {} }) }).then((r) => r.json());
  const id = signup?.user?.id;
  if (!id) fixture("could not make a throwaway anonymous user to test SESSION_SECRET — are anonymous sign-ins still on for pind-staging?");
  try {
    await fetch(`${base()}/auth/v1/admin/users/${id}`, { method: "PUT", headers: { ...S(), "content-type": "application/json" }, body: JSON.stringify({ app_metadata: { pind_harness: true } }) });
    const cookie = await seal(process.env.SESSION_SECRET, { userId: id, refreshToken: signup.refresh_token, issuedAt: Date.now() });
    const claim = await fetch(`${site}/session/claim`, { method: "POST", headers: { cookie: `pind_pin=${cookie}`, origin: site } });
    if (claim.status === 204) fixture("SESSION_SECRET in .dev.vars is not the deployed Worker's — the Worker cannot open a session this check seals. Put the Worker's value in .dev.vars (or re-set both).");
    if (claim.status !== 200) fixture(`the live /session/claim answered ${claim.status} to a fresh session — check the deploy before reading anything into the walk.`);
  } finally {
    await fetch(`${base()}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: S() });
  }
}
