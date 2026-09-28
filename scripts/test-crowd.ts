// Build or refresh the test crowd from a terminal (M3.2) — the same builder the admin's
// "Build the test crowd" button runs (src/admin/testcrowd.ts), with node's renderer in
// place of the Worker's. Staging only: it uses .dev.vars.
//
//   node --env-file=.dev.vars scripts/test-crowd.ts
import { Resvg } from "@cf-wasm/resvg/node";
import { createClient } from "@supabase/supabase-js";
import { buildTestCrowd } from "../src/admin/testcrowd.ts";

const url = process.env.SUPABASE_URL!.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const render = (svg: string) => new Resvg(svg).render().asPng();

const built = await buildTestCrowd(db, render);
console.log(`${built.people} test people at https://pind.social/crowd/${built.slug}`);
