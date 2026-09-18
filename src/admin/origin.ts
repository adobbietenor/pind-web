// Is this admin write coming from the admin's own pages? Your Access cookie is sent
// even when another site submits a form here, so every non-GET request must prove
// it is same-origin. Nothing here imports at runtime, so unit tests load it directly.
//
// Sec-Fetch-Site is set by the browser and cannot be set by page scripts, so it is
// the primary signal. Origin can legitimately be "null" (e.g. under some referrer
// policies), so it only decides when Sec-Fetch-Site is absent (older browsers).
// "same-site" is refused: other Workers under pind.workers.dev are the same site.

export type WriteCheck = { ok: true } | { ok: false; reason: string; origin: string; secFetchSite: string };

export function sameOriginWrite(method: string, url: string, headers: Headers): WriteCheck {
  if (method === "GET" || method === "HEAD") return { ok: true };
  const own = new URL(url).origin;
  const origin = headers.get("Origin");
  const site = headers.get("Sec-Fetch-Site");
  const refuse = (reason: string): WriteCheck => ({
    ok: false,
    reason,
    origin: origin ?? "(absent)",
    secFetchSite: site ?? "(absent)",
  });

  if (site !== null) {
    if (site !== "same-origin") return refuse("cross-site request");
    if (origin !== null && origin !== "null" && origin !== own) return refuse("origin does not match");
    return { ok: true };
  }
  if (origin === own) return { ok: true };
  return refuse("cannot prove same-origin");
}
