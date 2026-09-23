// PostHog through our own origin (M3.2). A26 is public and pasted into Reddit, so it
// talks to nobody but pind.social: the Worker forwards /ingest to PostHog. These prove
// where each request goes, what is NOT forwarded, and that the route is reachable at
// all (a route missing from run_worker_first silently serves the app, CLAUDE.md).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ingestHeaders, ingestTarget } from "../../src/routes/ingest.ts";

const at = (path: string) => ingestTarget(new URL(`https://pind.social${path}`))?.toString() ?? null;

describe("The /ingest proxy", () => {
  it("K01 events and flags go to the API host, with the path and query kept", () => {
    assert.equal(at("/ingest/batch/?ip=0"), "https://us.i.posthog.com/batch/?ip=0");
    assert.equal(at("/ingest/flags/?v=2"), "https://us.i.posthog.com/flags/?v=2");
  });

  it("K02 static files and remote config go to the assets host", () => {
    assert.equal(at("/ingest/static/array.js"), "https://us-assets.i.posthog.com/static/array.js");
    assert.equal(at("/ingest/array/phc_x/config"), "https://us-assets.i.posthog.com/array/phc_x/config");
  });

  it("K03 nothing outside /ingest is taken — not even a path that merely starts with the word", () => {
    assert.equal(at("/ingestion"), null);
    assert.equal(at("/g/some-slug/pin"), null);
    assert.equal(at("/"), null);
  });

  it("K04 no cookie, no client IP, no referring page is forwarded — only what PostHog needs to read the request", () => {
    const out = ingestHeaders(
      new Headers({
        cookie: "session=secret",
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "203.0.113.9",
        "x-real-ip": "203.0.113.9",
        referer: "https://www.reddit.com/r/toronto/comments/abc",
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0",
      }),
    );
    for (const gone of ["cookie", "cf-connecting-ip", "x-forwarded-for", "x-real-ip", "referer"]) {
      assert.equal(out.get(gone), null, `${gone} was forwarded`);
    }
    assert.equal(out.get("content-type"), "application/json");
  });

  it("K05 wrangler.jsonc sends /ingest to the Worker first — or the app's index.html would answer it with a 200", () => {
    const config = readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "");
    const from = config.indexOf("[", config.indexOf("run_worker_first"));
    const list = JSON.parse(config.slice(from, config.indexOf("]", from) + 1).replace(/,\s*]/, "]"));
    assert.ok(Array.isArray(list) && list.includes("/g/*"), "could not read run_worker_first (the check found nothing)");
    assert.ok(list.includes("/ingest/*") && list.includes("/ingest"), "the /ingest route is not in run_worker_first");
  });
});
