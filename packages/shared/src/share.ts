// "Share spot & time with a friend" — the group's share card (M3.3, W3).
//
// The link carries a spot and a time and nothing else: no group, no names, no way in
// (spec A12 — "a read-only card with no join link"). The public spots have no id, so
// the spot is named by a key made from its name. The app builds the key and the Worker
// matches it, **both with `spotKey`**, so the two sides can never normalise differently
// (the instrument rule; tests/unit/share.test.ts).

export const spotKey = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents, split off by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function shareCardUrl(site: string, slug: string, spot: string | null, meetAt: string | null): string {
  // Both values are URL-safe as built: a key is [a-z0-9-], a time is digits, "-", ":", "T", "Z".
  const q = [spot ? `at=${spotKey(spot)}` : null, meetAt ? `t=${new Date(meetAt).toISOString().slice(0, 16)}Z` : null].filter(Boolean);
  return `${site}/g/${slug}/spot${q.length ? `?${q.join("&")}` : ""}`;
}

// What the Worker shows: the named spot if it is one of this gathering's, and the time
// if it falls on this gathering's day. Anything else in the link is ignored, so a link
// someone edits by hand can only lose its highlight, never show something invented.
export function readShareCard<S extends { name: string }>(
  spots: S[],
  params: { get(name: string): string | null },
  gathering: { starts_at: string; effective_end: string },
): { spot: S | null; meetAt: string | null } {
  const at = params.get("at");
  const spot = at ? spots.find((s) => spotKey(s.name) === spotKey(at)) ?? null : null;
  const t = params.get("t");
  const ms = t ? Date.parse(t) : NaN;
  const lo = Date.parse(gathering.starts_at) - 12 * 3_600_000;
  const hi = Date.parse(gathering.effective_end) + 6 * 3_600_000;
  const meetAt = Number.isFinite(ms) && ms >= lo && ms <= hi ? new Date(ms).toISOString() : null;
  return { spot, meetAt };
}

export const SHARE_COPY = {
  button: "Share spot & time with a friend",
  meeting: "Meeting at",
  others: "The other spots",
  // PROPOSED — Tatiana's to rewrite.
  message: (gathering: string, spot: string | null, when: string | null) =>
    [gathering, spot && when ? `meeting at ${spot}, ${when}` : spot ? `meeting at ${spot}` : null].filter(Boolean).join(" — "),
} as const;
