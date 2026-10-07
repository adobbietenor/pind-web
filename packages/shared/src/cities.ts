// The cities Pin'd shows, and which one is live (Alex, 6 Oct 2026 — the app's home, A5).
//
// **One list, here, and nowhere else.** The app's city picker, the list it opens, and the
// Worker's W1 all read it, so a city going live is one line changed — not a picker, a
// label and a filter scattered across screens. It is fixed text, NOT the `cities` table:
// staging holds a Vancouver row for the walk gathering's time zone (scripts/
// walk-gathering.mjs), and a picker reading the table would show Vancouver as live.
//
// `slug` is the `cities.slug` a live city's gatherings are filed under; the list asks
// the database for that city's gatherings only (public_gatherings' p_city).
//
// PROPOSED copy (Tatiana's to reword): the names are names, "Coming soon" is copy.

export interface CityChoice {
  slug: string;
  name: string;
  live: boolean;
  // The city's own clock: a list's "Today" is today in the city, not on the phone.
  timezone: string;
}

export const CITIES: readonly CityChoice[] = [
  { slug: "toronto", name: "Toronto", live: true, timezone: "America/Toronto" },
  { slug: "vancouver", name: "Vancouver", live: false, timezone: "America/Vancouver" },
  { slug: "calgary", name: "Calgary", live: false, timezone: "America/Edmonton" },
  { slug: "montreal", name: "Montreal", live: false, timezone: "America/Toronto" },
];

// The city W1 and the app's list show. Exactly one is live today; when a second goes live,
// W1 (one city per site) is the place that will need a decision, and this throws until it
// has one rather than quietly picking.
export function liveCity(): CityChoice {
  const live = CITIES.filter((c) => c.live);
  if (live.length !== 1) throw new Error(`exactly one live city expected, found ${live.length} — W1 needs a decision`);
  return live[0]!;
}

// A city can be opened only if it is live. A slug that is not in the list is never live.
export function cityOpens(slug: string): boolean {
  return CITIES.some((c) => c.slug === slug && c.live);
}

export const HOME_COPY = {
  heading: "Find your crowd",
  line: "Pick a city to see who's going to what this week.",
  comingSoon: "Coming soon",
  profileHeading: "Set up your profile now?",
  profileLine: "Optional. You can do it later — Pin'd asks when you first pin in.",
  profileButton: "Set up my profile",
  listEmpty: "Nothing listed in the next seven days yet.",
} as const;
