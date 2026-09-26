// The merge's photo files, through the live Worker (M3.2 walk).
//
// The harness (P127–P132) proves the rows. This proves the FILES, which only the Worker
// moves: two real sessions — an anonymous pinner who uploaded a photo, and an account —
// POST /account/merge exactly as A27 does, and then the bucket is read:
//
//   A. the account has no photo → it takes the anonymous one, in ITS OWN folder, and the
//      anonymous folder is empty;
//   B. the account has a photo → its photo is untouched, nothing new lands in its folder,
//      and the anonymous folder is empty (the anonymous photo deleted, not kept).
//
//   npm run check:merge-photos
//
// Needs .dev.vars. Every user it makes is a harness user (the photo check skips them) and
// is deleted at the end, with their files.
import { randomUUID } from "node:crypto";

const SITE = process.env.PIND_SITE || "https://pind.social";
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
const S = { apikey: service, authorization: `Bearer ${service}` };
// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const must = async (res, what) => {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};
const rest = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...S, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
const files = async (folder) =>
  (await must(await fetch(`${base}/storage/v1/object/list/photos`, { method: "POST", headers: { ...S, "content-type": "application/json" }, body: JSON.stringify({ prefix: `${folder}/`, limit: 100 }) }), "list"))
    .filter((o) => o.id)
    .map((o) => o.name);
const upload = (token, path) =>
  fetch(`${base}/storage/v1/object/photos/${path}`, { method: "POST", headers: { apikey: pub, authorization: `Bearer ${token}`, "content-type": "image/png" }, body: PNG });
const harness = (id) => rest(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ app_metadata: { pind_harness: true } }) });

const made = [];
async function anonymousWithPhoto() {
  const s = await must(await fetch(`${base}/auth/v1/signup`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ data: {} }) }), "anon sign-up");
  made.push(s.user.id);
  await must(await harness(s.user.id), "mark anon");
  await must(await upload(s.access_token, `${s.user.id}/face.png`), "anon upload");
  await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: s.user.id, first_name: "Mergecheck", photo_path: `${s.user.id}/face.png` }) }), "anon person");
  return { id: s.user.id, token: s.access_token };
}
async function account(withPhoto) {
  const email = `pind-merge-check-${Date.now()}-${withPhoto ? "p" : "n"}@example.com`;
  const password = randomUUID();
  const u = await must(await rest("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pind_harness: true } }) }), "account");
  made.push(u.id);
  const t = await must(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), "account sign-in");
  if (withPhoto) await must(await upload(t.access_token, `${u.id}/mine.png`), "account upload");
  const [p] = await must(await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: u.id, first_name: "Mergeaccount", photo_path: withPhoto ? `${u.id}/mine.png` : null }) }), "account person");
  return { id: u.id, token: t.access_token, personId: p.id };
}
const merge = (anon, acct) =>
  fetch(`${SITE}/account/merge`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${acct.token}` }, body: JSON.stringify({ anon_access_token: anon.token }) });
const photoOf = async (personId) => (await must(await rest(`/rest/v1/people?id=eq.${personId}&select=photo_path`), "person"))[0]?.photo_path;

let ok = true;
try {
  // A. No photo on the account.
  {
    const anon = await anonymousWithPhoto();
    const acct = await account(false);
    const res = await merge(anon, acct);
    const out = await res.json().catch(() => null);
    const r = {
      status: res.status,
      took: out?.photo === true,
      path: (await photoOf(acct.personId)) === `${acct.id}/face.png`,
      fileInAccount: (await files(acct.id)).includes("face.png"),
      anonFolderEmpty: (await files(anon.id)).length === 0,
    };
    console.log(`A. account without a photo takes it: ${JSON.stringify(r)}`);
    ok &&= r.status === 200 && r.took && r.path && r.fileInAccount && r.anonFolderEmpty;
  }
  // B. The account has a photo: never replaced; the anonymous one is deleted.
  {
    const anon = await anonymousWithPhoto();
    const acct = await account(true);
    const res = await merge(anon, acct);
    const out = await res.json().catch(() => null);
    const inAccount = await files(acct.id);
    const r = {
      status: res.status,
      notTaken: out?.photo === false,
      pathUnchanged: (await photoOf(acct.personId)) === `${acct.id}/mine.png`,
      onlyItsOwnFile: inAccount.length === 1 && inAccount[0] === "mine.png",
      anonFolderEmpty: (await files(anon.id)).length === 0,
    };
    console.log(`B. account with a photo keeps it: ${JSON.stringify(r)}`);
    ok &&= r.status === 200 && r.notTaken && r.pathUnchanged && r.onlyItsOwnFile && r.anonFolderEmpty;
  }
} finally {
  for (const id of made) {
    const left = await files(id).catch(() => []);
    if (left.length) await fetch(`${base}/storage/v1/object/photos`, { method: "DELETE", headers: { ...S, "content-type": "application/json" }, body: JSON.stringify({ prefixes: left.map((n) => `${id}/${n}`) }) });
    await rest(`/rest/v1/people?auth_user_id=eq.${id}`, { method: "DELETE" });
    await rest(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  }
}
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
