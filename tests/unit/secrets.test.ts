// Configuration checks (Phase 2 M2.2). Built after the nightly import failed for two
// nights on a credential with nothing saying so: "unset" has to be a state the
// product can see and name, not something inferred from a failure.
// Run with `npm run test:unit`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alertsConfigured, checkSecrets, missingRequired } from "../../src/ops/secrets.ts";

const FULL = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  ACCESS_TEAM_DOMAIN: "https://x.cloudflareaccess.com",
  ACCESS_AUD: "aud",
  ADMIN_EMAILS: "alex@example.com",
  TICKETMASTER_CONSUMER_KEY: "tm",
};

const state = (env: Record<string, unknown>, name: string) => checkSecrets(env).find((c) => c.name === name)!.state;

describe("what counts as configured", () => {
  it("calls an absent secret missing and an empty one empty, because they are not the same mistake", () => {
    // A secret set to "" lists in `wrangler secret list` exactly like a real one and
    // then fails at the first .trim(). If the panel called both "not set", the one
    // that looks present in the tooling would be the one nobody could explain.
    assert.equal(state({}, "TICKETMASTER_CONSUMER_KEY"), "missing");
    assert.equal(state({ TICKETMASTER_CONSUMER_KEY: "" }, "TICKETMASTER_CONSUMER_KEY"), "empty");
    assert.equal(state({ TICKETMASTER_CONSUMER_KEY: "   " }, "TICKETMASTER_CONSUMER_KEY"), "empty");
    assert.equal(state({ TICKETMASTER_CONSUMER_KEY: "abc" }, "TICKETMASTER_CONSUMER_KEY"), "set");
  });

  it("reports nothing missing when every required secret is there", () => {
    assert.deepEqual(missingRequired(FULL), []);
  });

  it("names the Ticketmaster key as required, and says what stops if it is gone", () => {
    const [only] = missingRequired({ ...FULL, TICKETMASTER_CONSUMER_KEY: undefined });
    assert.equal(only!.name, "TICKETMASTER_CONSUMER_KEY");
    assert.match(only!.what, /nightly import/);
    assert.match(only!.what, /list stops refreshing/);
  });

  it("treats an empty required secret as missing, not as present", () => {
    assert.equal(missingRequired({ ...FULL, ADMIN_EMAILS: "" }).length, 1);
  });

  it("does not call an optional secret missing — the feature is off, which is different", () => {
    assert.deepEqual(missingRequired({ ...FULL, MAPBOX_TOKEN: undefined, ANTHROPIC_API_KEY: undefined }), []);
    assert.equal(state({ ...FULL }, "MAPBOX_TOKEN"), "missing");
  });

  it("covers every secret the Worker reads, so a new one cannot be forgotten here", () => {
    const named = new Set(checkSecrets({}).map((c) => c.name));
    for (const name of [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "ACCESS_TEAM_DOMAIN",
      "ACCESS_AUD",
      "ADMIN_EMAILS",
      "TICKETMASTER_CONSUMER_KEY",
      "ANTHROPIC_API_KEY",
      "MAPBOX_TOKEN",
      "RESEND_API_KEY",
      "ALERT_EMAIL",
      "SESSION_SECRET",
    ]) {
      assert.ok(named.has(name), `${name} is not on the configuration page`);
    }
  });
});

describe("whether an alert can actually go anywhere", () => {
  it("needs both a key and a destination — a key with nowhere to send is as dark as no key", () => {
    assert.equal(alertsConfigured({ RESEND_API_KEY: "re_x", ALERT_EMAIL: "alex@example.com" }), true);
    assert.equal(alertsConfigured({ RESEND_API_KEY: "re_x" }), false);
    assert.equal(alertsConfigured({ ALERT_EMAIL: "alex@example.com" }), false);
    assert.equal(alertsConfigured({ RESEND_API_KEY: "  ", ALERT_EMAIL: "alex@example.com" }), false);
    assert.equal(alertsConfigured({}), false);
  });
});
