// Runs the City of Toronto feed import once, from node, against the database in
// .dev.vars (staging) — the same module the 07:30 cron runs (src/import/cityrun.ts),
// not a copy of it. For the first import and for checking a change before a deploy.
//
//   node --env-file=.dev.vars scripts/city-import.mjs
import { runCityImport, CITY_IMPORTER } from "../src/import/cityrun.ts";

const outcome = await runCityImport(process.env, { trigger: "city-manual", actor: `${CITY_IMPORTER} (script)` });
console.log(outcome.message);
process.exit(outcome.status === "failed" ? 1 : 0);
