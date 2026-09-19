// The fixed neighbourhood list, in display order. Mirrors the rows seeded by
// supabase/migrations/20260918033807_initial_schema.sql; the database is the
// source of truth, so a change here needs a migration there.
export const NEIGHBOURHOODS = [
  { slug: "liberty-village", name: "Liberty Village" },
  { slug: "king-west", name: "King West" },
  { slug: "cityplace", name: "CityPlace" },
  { slug: "fort-york", name: "Fort York" },
  { slug: "queen-west", name: "Queen West" },
  { slug: "trinity-bellwoods", name: "Trinity Bellwoods" },
  { slug: "ossington", name: "Ossington" },
  { slug: "dundas-west", name: "Dundas West" },
  { slug: "little-portugal", name: "Little Portugal" },
  { slug: "little-italy", name: "Little Italy" },
  { slug: "kensington-market", name: "Kensington Market" },
  { slug: "the-annex", name: "The Annex" },
  { slug: "harbourfront", name: "Harbourfront" },
  { slug: "st-lawrence", name: "St. Lawrence" },
  { slug: "church-wellesley", name: "Church-Wellesley" },
  { slug: "yorkville", name: "Yorkville" },
  { slug: "leslieville", name: "Leslieville" },
  { slug: "riverside", name: "Riverside" },
  { slug: "the-danforth", name: "The Danforth" },
  { slug: "junction", name: "Junction" },
  { slug: "roncesvalles", name: "Roncesvalles" },
  { slug: "high-park", name: "High Park" },
  { slug: "parkdale", name: "Parkdale" },
  { slug: "leaside", name: "Leaside" },
  { slug: "midtown", name: "Midtown" },
  { slug: "north-york", name: "North York" },
  { slug: "scarborough", name: "Scarborough" },
  { slug: "etobicoke", name: "Etobicoke" },
  { slug: "east-york", name: "East York" },
  { slug: "outside-toronto", name: "Outside Toronto" },
] as const;

export type NeighbourhoodSlug = (typeof NEIGHBOURHOODS)[number]["slug"];
