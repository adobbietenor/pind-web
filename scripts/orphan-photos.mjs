// Face photos with nobody behind them (M3.2).
//
// The privacy page promises a photo does not outlive its person. The merge used to
// delete the anonymous person and user and leave their photo in the bucket — found on
// Alex's walk. This lists every file in the private `photos` bucket and sorts it:
//
//   orphaned     its folder's user no longer exists — nobody can ever see or remove it
//   unreferenced its user exists, but no person points at this file (a replaced photo)
//   in use       a person's photo_path
//
//   npm run check:orphan-photos              list only
//   npm run check:orphan-photos -- --delete  delete the orphaned ones (never the others)
//
// Exits 1 while any orphan remains, so it can gate a deploy or a cron.
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
const del = process.argv.includes("--delete");

const list = async (prefix) => {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await (await fetch(`${base}/storage/v1/object/list/photos`, { method: "POST", headers: h, body: JSON.stringify({ prefix, limit: 1000, offset }) })).json();
    if (!Array.isArray(page)) throw new Error(`list ${prefix}: ${JSON.stringify(page)}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
};

const folders = (await list("")).filter((o) => o.id === null).map((o) => o.name);
const inUse = new Set();
for (let offset = 0; ; offset += 1000) {
  const rows = await (await fetch(`${base}/rest/v1/people?select=photo_path&photo_path=not.is.null&limit=1000&offset=${offset}`, { headers: h })).json();
  for (const r of rows) inUse.add(r.photo_path);
  if (rows.length < 1000) break;
}

const orphaned = [];
const unreferenced = [];
let used = 0;
for (const folder of folders) {
  const files = (await list(`${folder}/`)).filter((o) => o.id !== null).map((o) => ({ path: `${folder}/${o.name}`, at: o.created_at }));
  if (!files.length) continue;
  const user = await fetch(`${base}/auth/v1/admin/users/${folder}`, { headers: h });
  const exists = user.ok;
  for (const f of files) {
    if (!exists) orphaned.push(f);
    else if (inUse.has(f.path)) used++;
    else unreferenced.push(f);
  }
}

console.log(`${folders.length} folders · ${used} in use · ${unreferenced.length} unreferenced (user exists) · ${orphaned.length} ORPHANED (user deleted)`);
for (const f of orphaned) console.log(`  orphaned      ${f.path}  (${f.at})`);
for (const f of unreferenced) console.log(`  unreferenced  ${f.path}  (${f.at})`);

if (del && orphaned.length) {
  const res = await fetch(`${base}/storage/v1/object/photos`, { method: "DELETE", headers: h, body: JSON.stringify({ prefixes: orphaned.map((f) => f.path) }) });
  const gone = await res.json();
  console.log(`deleted ${Array.isArray(gone) ? gone.length : 0} of ${orphaned.length}: ${res.status}`);
  const left = [];
  for (const f of orphaned) {
    const [folder, name] = f.path.split("/");
    if ((await list(`${folder}/`)).some((o) => o.name === name)) left.push(f.path);
  }
  console.log(left.length ? `STILL THERE: ${left.join(", ")}` : "re-listed: none of them remain");
  process.exit(left.length ? 1 : 0);
}
process.exit(orphaned.length ? 1 : 0);
