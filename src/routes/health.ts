import type { Env } from "../env";
import { escape, page } from "../html";
import { serviceClient } from "../supabase";

// GET /health — proves the Worker can reach pind-staging. Reads the row count of
// neighbourhoods (reference data, not people), so serviceClient is fine here.
export async function health(_request: Request, env: Env): Promise<Response> {
  const supabase = serviceClient(env);
  const { count, error, status } = await supabase
    .from("neighbourhoods")
    .select("*", { count: "exact", head: true });

  if (error) {
    // Supabase error messages name the problem (bad key, missing table) without
    // echoing secrets, and this page is for us, so show it plainly.
    return page(
      "Health",
      `<h1>Health</h1><p class="error">Supabase error: ${escape(error.message || error.code || "unknown")}</p>`,
      502,
    );
  }

  // No count is not zero (H6). supabase-js turns an empty 404 into "no error,
  // no count", so a missing count means the request never reached the table.
  if (count === null) {
    return page(
      "Health",
      `<h1>Health</h1><p class="error">Supabase returned no count (status ${escape(status)}) — check SUPABASE_URL</p>`,
      502,
    );
  }

  return page("Health", `<h1>Health</h1><p>neighbourhoods: ${escape(count)}</p>`);
}
