// Mint the Apple client secret for Supabase's Apple provider (Phase 3 M3.1).
//
// Supabase's field says "Secret key should be a JWT" because that is what Apple
// wants: not the `.p8`, but a short-lived JWT **signed with** the `.p8`.
//
// **The `.p8` never leaves your machine.** It is read from a path you give, used to
// sign, and never printed, copied, uploaded or committed. This script refuses to run
// if the key sits anywhere inside this repository, because a private key one `git add
// -A` away from being published is a different risk from one that is not. Keep it in
// a password manager: **Apple lets you download a key exactly once**, and the rule
// here is create, never revoke (decisions Part 5) — losing it means making another,
// and the Tenor team is near Apple's limit.
//
// Usage, from the repo root:
//
//   node scripts/apple-client-secret.ts \
//     --key ~/Downloads/AuthKey_ABC1234DEF.p8 --kid ABC1234DEF
//
// Optional: --months 6 (Apple's maximum, and the default).
//
// **What Apple checks, and therefore what must match exactly:**
//   iss  the Team ID          93M6B4W5PR
//   sub  the Services ID      social.pind.web   — NOT the app's bundle identifier
//   aud  https://appleid.apple.com
//   kid  the Key ID           the ten characters in the .p8's filename
//
// **ES256 in a JWS is the raw r‖s signature, not DER.** Node signs EC as DER by
// default, and a DER signature here produces `invalid_client` from Apple with nothing
// saying why — so `dsaEncoding: "ieee-p1363"` below is load-bearing, not a detail.

import { readFile } from "node:fs/promises";
import { createPrivateKey, sign } from "node:crypto";
import { resolve } from "node:path";
import { homedir } from "node:os";

const TEAM_ID = "93M6B4W5PR"; // Tenor Investments Inc. — Pin'd publishes under it.
const SERVICES_ID = "social.pind.web"; // The Services ID, not the bundle identifier.
const AUDIENCE = "https://appleid.apple.com";
const MAX_MONTHS = 6; // Apple's cap.

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : null;
};

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

async function main() {
  const keyPath = flag("key");
  const kid = flag("kid");
  const months = Math.min(Number(flag("months") ?? MAX_MONTHS), MAX_MONTHS);
  if (!keyPath || !kid) {
    throw new Error("Usage: --key <path to AuthKey_XXXX.p8> --kid <the ten-character Key ID>");
  }
  if (!/^[A-Z0-9]{10}$/.test(kid)) {
    throw new Error(`"${kid}" does not look like a Key ID: ten uppercase letters and digits.`);
  }

  const full = resolve(keyPath.replace(/^~(?=$|\/|\\)/, homedir()));
  if (full.startsWith(resolve(process.cwd()))) {
    throw new Error(
      `Refusing to read a private key from inside the repository (${full}).\n` +
        `Move it somewhere outside pind-web — a key one "git add -A" away from being published is a different risk.`,
    );
  }

  const pem = await readFile(full, "utf8");
  if (!pem.includes("BEGIN PRIVATE KEY")) {
    throw new Error("That file is not a PKCS#8 private key. Apple's .p8 begins with -----BEGIN PRIVATE KEY-----.");
  }
  const key = createPrivateKey(pem);

  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.round(months * 30.4375 * 24 * 60 * 60);
  const header = b64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iss: TEAM_ID, iat: now, exp, aud: AUDIENCE, sub: SERVICES_ID }),
  );
  // ieee-p1363 is the raw 64-byte r‖s a JWS needs. DER here means `invalid_client`.
  const signature = b64url(sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" }));

  const expires = new Date(exp * 1000);
  const day = expires.toISOString().slice(0, 10);

  console.log(`\n${header}.${payload}.${signature}\n`);
  console.log(`Team ID      ${TEAM_ID}`);
  console.log(`Services ID  ${SERVICES_ID}`);
  console.log(`Key ID       ${kid}`);
  console.log(`Expires      ${day} (${months} months — Apple's maximum)\n`);
  console.log("Paste the JWT above into Supabase → Authentication → Providers → Apple → Secret Key.");
  console.log("Then record the expiry so the admin can warn before it lapses — in wrangler.jsonc:\n");
  console.log(`    "APPLE_SECRET_EXPIRES": "${day}"\n`);
  console.log("and deploy. Web Apple sign-in stops working the day it lapses, silently, and");
  console.log("native iOS sign-in keeps working — which makes it easier to miss, not harder.\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
