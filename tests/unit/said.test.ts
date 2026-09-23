// What a person may read about a failure (M3.1, from the web photo walk).
//
// **Written because a hostname reached the screen.** The failed-upload sentence read
// "We could not upload your photo — load failed (mxuajvlrkggrqpntekqt.supabase.co)":
// Safari's own error text, passed through. These put the raw strings the libraries
// really produce in front of every person-facing sentence and insist none of them
// leaks — and prove the leak check itself fires on each shape (a guard proved by
// making it refuse, CLAUDE.md).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PHOTO_UPLOAD_FAILED } from "../../packages/shared/src/a2photo.ts";
import { looksTechnical, UPLOAD_OTHER, UPLOAD_TOO_BIG, UPLOAD_UNREACHABLE, uploadReason } from "../../packages/shared/src/said.ts";
import { readSession, sessionSays } from "../../packages/shared/src/session.ts";
import { SIGNIN_FAILED, signInSays } from "../../packages/shared/src/signin.ts";

// Raw error text, as the walk and the libraries produce it.
const RAW = [
  "Load failed (mxuajvlrkggrqpntekqt.supabase.co)", // the walk, Safari
  "TypeError: Network request failed",
  'new row violates row-level security policy for table "objects"',
  'duplicate key value violates unique constraint "people_auth_user_id_key"',
  "permission denied for table people_private (42501)",
  "JSON object requested, multiple (or no) rows returned PGRST116",
  'relation "public.person_tags" does not exist',
  "Unable to exchange external code: https://appleid.apple.com/auth/token",
  "invalid_client",
  "Database error saving new user",
  "HTTP 503 Service Unavailable",
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0",
  "Write to someone@notpind.social about it", // a lookalike of our domain is still a host
];

describe("The leak check fires on every raw shape (both sides of the guard)", () => {
  it("L01 each raw string that carries a host, code, identifier or token is flagged", () => {
    const carrying = RAW.filter((r) => !/^(TypeError: Network request failed|Database error saving new user)$/.test(r));
    for (const raw of carrying) assert.ok(looksTechnical(raw), `not flagged: ${raw}`);
  });

  it("L02 a plain sentence we wrote is not flagged", () => {
    for (const ok of [
      "We could not upload your photo — Pin'd could not be reached.",
      "That already exists.",
      "You are signed out on this device. Sign in again to carry on.",
      "Write to privacy@pind.social, or see pind.social/privacy.",
    ])
      assert.ok(!looksTechnical(ok), `flagged: ${ok}`);
  });
});

describe("No person-facing sentence can print a raw error", () => {
  it("L03 the walk's upload failure reads in words — no hostname", () => {
    const walk = new TypeError("Load failed (mxuajvlrkggrqpntekqt.supabase.co)");
    assert.equal(uploadReason(walk), UPLOAD_UNREACHABLE);
    const says = PHOTO_UPLOAD_FAILED(uploadReason(walk));
    assert.doesNotMatch(says, /supabase|load failed/i);
    assert.ok(!looksTechnical(says), says);
  });

  it("L04 every upload failure maps to one of three reasons, none of them the error's text", () => {
    assert.equal(uploadReason({ statusCode: "413", message: "Payload too large" }), UPLOAD_TOO_BIG);
    assert.equal(uploadReason({ status: 400, message: RAW[2] }), UPLOAD_OTHER);
    for (const raw of RAW) {
      const says = PHOTO_UPLOAD_FAILED(uploadReason({ message: raw }));
      assert.ok(!looksTechnical(says), `${raw} → ${says}`);
    }
  });

  it("L05 sign-in never passes a provider's text through", () => {
    for (const step of ["send", "verify", "oauth"] as const)
      for (const raw of RAW) {
        const says = signInSays(step, raw);
        assert.ok(!looksTechnical(says), `${step}: ${raw} → ${says}`);
        assert.ok(!says.includes(raw), `${step}: passed through ${raw}`);
      }
    assert.equal(signInSays("oauth", "invalid_client"), SIGNIN_FAILED);
  });

  it("L06 an unrecognised session error keeps its message for Sentry, not for the sentence", () => {
    const read = readSession(null, { name: "Weird", message: RAW[3], status: 500 });
    assert.equal(read.state, "unsure");
    assert.ok(!looksTechnical(sessionSays(read as never)));
  });

  it("L07 every sentence @pind/shared exports reads as words (a new one is checked too)", async () => {
    const dir = join(process.cwd(), "packages", "shared", "src");
    const shared: Record<string, unknown> = {};
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !/^(index|database\.types)\.ts$/.test(f)))
      Object.assign(shared, await import(pathToFileURL(join(dir, file)).href));
    // Not person copy: tokens, slugs, the brand's markup, keys.
    const notCopy = /^(colors|fonts|radius|spacing|THRESHOLD|LOGO|BRAND|WORDMARK|NEIGHBOURHOODS|ALL_TAGS|TAG_GROUPS|EMAIL_CODE_LENGTH)/;
    const strings = Object.entries(shared).filter(([name, v]) => typeof v === "string" && !notCopy.test(name));
    assert.ok(strings.length >= 15, `only ${strings.length} exported sentences found`);
    const leaking = strings.filter(([, v]) => looksTechnical(v as string)).map(([name]) => name);
    assert.deepEqual(leaking, []);
  });
});
