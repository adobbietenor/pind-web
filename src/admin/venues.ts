// Venues, their curated meeting spots, AI-suggested spots awaiting approval,
// aliases and external ids for import matching, and the static map image.
//
// Map images go in the PUBLIC venue-maps bucket (decisions Part 5): a public building
// and its public spots, never a person (H1). Only this admin writes there.
import { spotSuggestionsOn } from "../env";
import { MAX_ATTEMPTS, chooseZoom, frameMetres, place, renderVenueMap } from "../public/venuemap";
import { distanceKm } from "../import/ticketmaster";
import type { AdminContext, AdminHandler } from "./context";
import { adminPage, back, e, here, link, must, notFound, postButton, str } from "./ui";

const MAPS = "venue-maps";
const MAP_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAP_MAX_BYTES = 2 * 1024 * 1024;

// GET /admin/venues
// A venue belongs near its own spots. Kept as a standing check because it caught a
// geocode that every other test passed: "1053 Dundas St W" fell back to the street
// centroid and landed in the Junction, four kilometres from the market, comfortably
// inside Toronto's bounding box and therefore inside any is-this-Toronto test. It
// also found Poetry Jazz Cafe at 1.8 km from Sneaky Dee's on its own, which was a
// known problem nothing was watching.
//
// A kilometre is generous: a curated spot is meant to be a short walk (H5), so
// anything past it is either a bad coordinate or a spot that should not be on that
// venue's poll. Either way somebody should look.
const STRAY_KM = 1;

async function strandedSpots(ctx: AdminContext): Promise<{ venue: string; venueId: string; spot: string; km: number }[]> {
  const rows = await must(
    ctx.db
      .from("venues")
      .select("id, name, latitude, longitude, meeting_spots(name, latitude, longitude, active)")
      .not("latitude", "is", null),
  );
  const out: { venue: string; venueId: string; spot: string; km: number }[] = [];
  for (const v of rows as any[]) {
    for (const s of (v.meeting_spots ?? []) as any[]) {
      if (!s.active || s.latitude === null) continue;
      const km = distanceKm(v.latitude, v.longitude, s.latitude, s.longitude);
      if (km > STRAY_KM) out.push({ venue: v.name, venueId: v.id, spot: s.name, km });
    }
  }
  return out.sort((a, b) => b.km - a.km);
}

export function strandedSpotsPanel(strays: { venue: string; venueId: string; spot: string; km: number }[]): string {
  if (!strays.length) return "";
  const rows = strays
    .map(
      (x) => `<tr><td><a href="/admin/venues/${e(x.venueId)}">${e(x.venue)}</a></td><td>${e(x.spot)}</td>
<td class="bad">${x.km.toFixed(2)} km away</td></tr>`,
    )
    .join("");
  return `<h2 class="bad">Spots a long way from their venue (${strays.length})</h2>
<p class="muted">A curated spot is meant to be a short walk. Over ${STRAY_KM} km it is either a bad coordinate — a geocode that
fell back to a street centroid will still be in Toronto and still be wrong — or a spot that does not belong on this venue's poll.</p>
<table><tr><th>Venue</th><th>Spot</th><th></th></tr>${rows}</table>`;
}

export const venueList: AdminHandler = async (request, ctx) => {
  const [venues, renders] = await Promise.all([
    must(
      ctx.db
        .from("venues")
        .select("id, name, city, address, latitude, map_image_path, meeting_spots(active), spot_suggestions(status)")
        .order("name"),
    ),
    must(ctx.db.from("venue_map_renders").select("venue_id, status, attempts")),
  ]);
  const byVenue = new Map<string, any[]>();
  for (const r of renders) byVenue.set(r.venue_id, [...(byVenue.get(r.venue_id) ?? []), r]);

  const strays = await strandedSpots(ctx);

  // A venue whose map keeps failing shows the fallback forever and is otherwise
  // invisible. Count them here, where they are looked for.
  const failing = venues.filter((v: any) => {
    const rs = byVenue.get(v.id) ?? [];
    return rs.length > 0 && !rs.some((r) => r.status === "ok");
  });
  const stuck = failing.filter((v: any) => (byVenue.get(v.id) ?? []).some((r) => r.attempts >= MAX_ATTEMPTS));

  const rows = venues
    .map((v: any) => {
      const approved = (v.meeting_spots ?? []).filter((s: any) => s.active).length;
      const pending = (v.spot_suggestions ?? []).filter((s: any) => s.status === "pending").length;
      const rs = byVenue.get(v.id) ?? [];
      const ok = rs.some((r) => r.status === "ok");
      const gaveUp = rs.some((r) => r.attempts >= MAX_ATTEMPTS);
      const map = v.map_image_path
        ? "uploaded"
        : ok
          ? `<span class="good">ready</span>`
          : gaveUp
            ? `<span class="bad">gave up</span>`
            : rs.length
              ? `<span class="bad">failing</span>`
              : v.latitude === null
                ? `<span class="bad">no coordinates</span>`
                : `<span class="muted">not fetched</span>`;
      return `<tr><td><a href="/admin/venues/${e(v.id)}">${e(v.name)}</a></td><td>${e(v.city)}</td>
<td>${approved >= 3 ? `<span class="good">${approved} ✓</span>` : `<span class="bad">${approved} ✗</span>`}</td>
<td>${pending ? `<strong>${pending} to review</strong>` : ""}</td><td>${map}</td></tr>`;
    })
    .join("");
  const noToken = !ctx.env.MAPBOX_TOKEN?.trim()
    ? `<p class="bad">MAPBOX_TOKEN is not set, so no crowd page map can be fetched at all. Every venue falls back to the schematic or the spot list. Set it with <code>npx wrangler secret put MAPBOX_TOKEN</code>.</p>`
    : "";
  const banner = failing.length
    ? `<p class="bad">${failing.length} venue${failing.length === 1 ? "" : "s"} cannot fetch a crowd page map${stuck.length ? `, and ${stuck.length} of them stopped retrying after ${MAX_ATTEMPTS} attempts` : ""}. Their crowd pages fall back quietly, so they only show up here: ${failing.map((v: any) => `<a href="/admin/venues/${e(v.id)}">${e(v.name)}</a>`).join(", ")}</p>`
    : "";
  const body = `${noToken}${banner}${strandedSpotsPanel(strays)}<table><tr><th>Venue</th><th>City</th><th>Approved spots</th><th>AI suggestions</th><th>Map</th></tr>
${rows || `<tr><td colspan="5">No venues yet.</td></tr>`}</table>
<h2>Add a venue</h2>
<form method="post" action="/admin/venues"><input type="hidden" name="back" value="/admin/venues">
<label>Name<br><input name="name" required maxlength="200" size="40"></label>
<label>Address (optional)<br><input name="address" maxlength="300" size="60"></label>
<button>Add venue</button></form>`;
  return adminPage(request, ctx.email, "Venues", body);
};

// POST /admin/venues — city defaults to Toronto (no city UI).
export const createVenue: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const name = str(form, "name");
  if (!name) return back(form, { err: "Name is required" });
  const { data, error } = await ctx.db
    .from("venues")
    .insert({ name, address: str(form, "address") || null })
    .select("id")
    .single();
  if (error) return back(form, { err: error.message });
  return back(null, { ok: "Venue added" }, `/admin/venues/${data.id}`);
};


// What the crowd page's map is doing for this venue, and why it is not doing it.
// A venue whose picture fails every time would otherwise be invisible — it would just
// show the fallback forever, with nobody the wiser.
function mapPanel(v: any, renders: any[], noToken: boolean, zoom: number): string {
  if (v.latitude === null) {
    return `<p class="bad">No coordinates, so no map can be fetched. The crowd page falls back to the schematic, or to the spot list. Add coordinates above.</p>`;
  }
  const current = renders.find((r) => r.status === "ok");
  const failed = renders.filter((r) => r.status !== "ok");
  const frame = frameMetres(v.latitude, zoom);

  const lines: string[] = [];
  if (noToken) {
    lines.push(
      `<p class="bad">MAPBOX_TOKEN is not set, so nothing can be fetched. This is a Worker secret, not a per-venue problem.</p>`,
    );
  }
  lines.push(
    `<p class="muted">Drawn at zoom ${zoom}, so the frame is about ${frame} m across, centred on the venue. The zoom comes from this venue's own spots: the picture goes as far in as it can while still holding every spot that fits at zoom 16, so spots a two-minute walk apart do not land on top of each other. A spot outside the widest frame is listed on the crowd page with its walking minutes and a directions link, and the page says it is not on the map.</p>`,
  );
  if (current) {
    lines.push(
      `<p class="good">Map ready${current.bytes ? ` · ${Math.round(current.bytes / 1024)} KB` : ""} · fetched ${e(new Date(current.updated_at).toLocaleString("en-CA"))}</p>`,
    );
  } else {
    lines.push(`<p class="muted">No map fetched yet. The next visit to a crowd page here fetches one in the background.</p>`);
  }
  for (const r of failed) {
    const stuck = r.attempts >= MAX_ATTEMPTS;
    lines.push(
      `<p class="bad">${stuck ? `Gave up after ${r.attempts} attempts` : `Failed ${r.attempts} time(s)`} · ${e(r.last_error ?? "no reason recorded")}` +
        (stuck ? ` <br>It will not be retried on its own. Fix the cause, then use Fetch again.` : "") +
        `</p>`,
    );
  }
  return lines.join("");
}

// GET /admin/venues/:id
export const venueDetail: AdminHandler = async (request, ctx) => {
  const { db } = ctx;
  const id = ctx.params.id!;
  const v = await must(db.from("venues").select("*").eq("id", id).maybeSingle());
  if (!v) return notFound(request, ctx.email);
  const [spots, suggestions, aliases, externals, renders] = await Promise.all([
    must(db.from("meeting_spots").select("*").eq("venue_id", id).order("sort_order").order("created_at")),
    must(db.from("spot_suggestions").select("*").eq("venue_id", id).eq("status", "pending").order("created_at")),
    must(db.from("venue_aliases").select("id, alias").eq("venue_id", id).order("alias")),
    must(db.from("venue_external_ids").select("source, external_id, needs_review").eq("venue_id", id)),
    must(db.from("venue_map_renders").select("map_key, status, attempts, last_error, bytes, updated_at").eq("venue_id", id)),
  ]);

  // A spot outside the crowd page's map frame is the M5.2 distance signal, seen here
  // rather than only by a stranger on the public page.
  // The zoom this venue's picture is drawn at, from its own active spots — the same
  // answer the crowd page and the render job get, from the same input.
  const zoom = chooseZoom(v, spots.filter((s: any) => s.active));
  const offMap = (sp: any): boolean =>
    v.latitude !== null && sp.latitude !== null && !place(
      { latitude: v.latitude, longitude: v.longitude },
      { latitude: sp.latitude, longitude: sp.longitude },
      zoom,
    ).onMap;
  const backTo = here(request);
  const approved = spots.filter((s: any) => s.active).length;

  const spotRows = spots
    .map(
      (s: any) => `<tr><td colspan="5"><form method="post" action="/admin/spots/${e(s.id)}">
<input type="hidden" name="back" value="${e(backTo)}">
<input name="name" required maxlength="80" size="24" value="${e(s.name)}">
<input name="description" size="40" placeholder="description" value="${e(s.description)}">
order <input name="sort_order" type="number" style="width:4em" value="${e(s.sort_order)}">
<label style="display:inline"><input type="checkbox" name="active"${s.active ? " checked" : ""}> approved</label>
${offMap(s) ? `<br><span class="bad">Outside the crowd page's map frame — too far from the venue to be drawn, and the page says so. This is the M5.2 distance signal: check it is really a five-minute walk.</span>` : ""}
<br><span class="muted">map:</span>
lat <input name="latitude" size="11" placeholder="43.6429" value="${e(s.latitude ?? "")}">
lng <input name="longitude" size="11" placeholder="-79.3776" value="${e(s.longitude ?? "")}">
walk <input name="walk_minutes" type="number" min="1" max="60" style="width:4em" placeholder="auto" value="${e(s.walk_minutes ?? "")}"> min
<button class="plain">Save</button></form></td></tr>`,
    )
    .join("");

  const suggestionRows = suggestions
    .map(
      (s: any) => `<tr><td><form class="inline" method="post" action="/admin/suggestions/${e(s.id)}/approve">
<input type="hidden" name="back" value="${e(backTo)}">
<input name="name" required maxlength="80" size="24" value="${e(s.name)}">
<input name="description" size="40" value="${e(s.description)}">
<button>Approve</button></form>
${postButton(`/admin/suggestions/${s.id}/reject`, "Reject", backTo, { cls: "plain" })}
<br><span class="muted">AI: ${e(s.reason ?? "")}${s.address ? ` · ${e(s.address)}` : ""}</span>${s.evidence_url ? ` · ${link(s.evidence_url, "page it checked")}` : ""}</td></tr>`,
    )
    .join("");
  const review = externals.some((x: any) => x.needs_review)
    ? `<p class="bad">New from Ticketmaster: check it isn't a venue you already have. Use the draft queue's "New venues" list to merge it,
or ${postButton(`/admin/venues/${id}/confirm`, "Looks right", backTo, { cls: "plain" })}</p>`
    : "";
  const suggest =
    approved < 3 && spotSuggestionsOn(ctx.env)
      ? postButton(`/admin/venues/${id}/suggest`, suggestions.length ? "Suggest again" : "Suggest spots now (AI, ~1 minute)", backTo, {
          cls: "plain",
        })
      : "";

  const mapUrl = v.map_image_path ? db.storage.from(MAPS).getPublicUrl(v.map_image_path).data.publicUrl : null;

  const body = `
${review}
<form method="post" action="/admin/venues/${e(id)}"><input type="hidden" name="back" value="${e(backTo)}">
<label>Name<br><input name="name" required maxlength="200" size="40" value="${e(v.name)}"></label>
<label>Address<br><input name="address" maxlength="300" size="60" value="${e(v.address)}"></label>
<label>Coordinates <span class="muted">— the centre of the generated map. Ticketmaster fills these in; a venue added by hand needs them, or its crowd pages get no map.</span><br>
lat <input name="latitude" size="12" value="${e(v.latitude ?? "")}"> lng <input name="longitude" size="12" value="${e(v.longitude ?? "")}"></label>
<p class="muted">City: ${e(v.city)}</p>
<button class="plain">Save venue</button></form>

<h2>Meeting spots — ${approved ? `<span class="good">${approved} approved</span>` : `<span class="muted">none approved yet (needed when crews open)</span>`}</h2>
<p class="muted">Curated public places only (H5). Any number can be approved; each spot poll shows the first 3, by order. Spots are optional to publish and needed when crews open.</p>
<p class="muted">Coordinates put a spot on the generated crowd-page map. Leave walk blank and the map works the minutes out from the distance; fill it in when that comes out wrong (across a rail corridor, a bridge that only crosses one way). A spot with no coordinates is still listed by name, just not plotted.</p>
<table>${spotRows || `<tr><td class="muted">None yet.</td></tr>`}</table>
<form method="post" action="/admin/venues/${e(id)}/spots"><input type="hidden" name="back" value="${e(backTo)}">
<input name="name" required maxlength="80" size="24" placeholder="New spot name">
<input name="description" size="40" placeholder="description">
lat <input name="latitude" size="11" placeholder="43.6429">
lng <input name="longitude" size="11" placeholder="-79.3776">
<button class="plain">Add spot</button></form>

<h2>AI-suggested spots awaiting approval (${suggestions.length})</h2>
<p class="muted">Not public until approved. Edit the name or description before approving if needed. Check the page each one links to.</p>
<table>${suggestionRows || `<tr><td class="muted">None pending.</td></tr>`}</table>
<p>${suggest}</p>

<h2>Crowd page map</h2>
<p class="muted">The venue and its meeting spots, never people (H1). The picture is fetched once from Mapbox for these coordinates and served from pind.social, never from Supabase. Markers, names and walking minutes are drawn over it by the page, so approving a spot later needs no new picture.</p>
${mapPanel(v, renders, !ctx.env.MAPBOX_TOKEN?.trim(), zoom)}
${v.latitude !== null ? postButton(`/admin/venues/${id}/map/fetch`, renders.some((r: any) => r.status === "ok") ? "Fetch the map again" : "Fetch the map now", backTo, { cls: "plain" }) : ""}
<h3>Uploaded override</h3>
<p class="muted">Optional. An uploaded image replaces the fetched one. PNG, JPEG or WebP, up to 2 MB.</p>
${mapUrl ? `<p><img src="${e(mapUrl)}" alt="map" style="max-width:360px;border:1px solid #ccc"></p>` : `<p class="muted">None.</p>`}
<form method="post" action="/admin/venues/${e(id)}/map" enctype="multipart/form-data"><input type="hidden" name="back" value="${e(backTo)}">
<input type="file" name="map" accept="image/png,image/jpeg,image/webp" required> <button class="plain">Upload map</button></form>

<h2>Matching imports</h2>
<p>Aliases (other names the sources use):</p>
<ul>${aliases.map((a: any) => `<li>${e(a.alias)} ${postButton(`/admin/aliases/${a.id}/delete`, "Remove", backTo, { cls: "plain" })}</li>`).join("") || `<li class="muted">None.</li>`}</ul>
<form method="post" action="/admin/venues/${e(id)}/aliases"><input type="hidden" name="back" value="${e(backTo)}">
<input name="alias" required maxlength="200" size="40" placeholder="e.g. Scotiabank Centre"> <button class="plain">Add alias</button></form>
<p>External ids:</p>
<ul>${externals.map((x: any) => `<li>${e(x.source)} · ${e(x.external_id)} ${postButton(`/admin/venues/${id}/external-ids/delete`, "Remove", backTo, { cls: "plain", fields: { source: x.source, external_id: x.external_id } })}</li>`).join("") || `<li class="muted">None.</li>`}</ul>
<form method="post" action="/admin/venues/${e(id)}/external-ids"><input type="hidden" name="back" value="${e(backTo)}">
<select name="source"><option value="ticketmaster">ticketmaster</option><option value="ai">ai</option></select>
<input name="external_id" required maxlength="200" placeholder="source's venue id"> <button class="plain">Add id</button></form>`;
  return adminPage(request, ctx.email, v.name, body);
};

// A coordinate field: blank clears it, anything that is not a number in range is
// refused rather than silently dropped. Latitude and longitude go together
// (the database constraint says so too).
function coords(form: FormData): { latitude: number | null; longitude: number | null } | string {
  const read = (name: string, limit: number): number | null | string => {
    const raw = str(form, name);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) > limit) return `${name} must be a number between -${limit} and ${limit}`;
    return n;
  };
  const latitude = read("latitude", 90);
  if (typeof latitude === "string") return latitude;
  const longitude = read("longitude", 180);
  if (typeof longitude === "string") return longitude;
  if ((latitude === null) !== (longitude === null)) return "Give both latitude and longitude, or neither";
  return { latitude, longitude };
}


// POST /admin/venues/:id/map — fetch (or re-fetch) the crowd page's map.
// Clearing the record first is what makes this a deliberate retry rather than a way
// round the attempt cap: the cap stops a silent loop, not Alex pressing a button.
export const fetchVenueMap: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const id = ctx.params.id!;
  const venue = await must(ctx.db.from("venues").select("id, latitude, longitude").eq("id", id).maybeSingle());
  if (!venue?.latitude) return back(form, { err: "The venue needs coordinates first" });

  const { data: key } = await ctx.db.rpc("venue_map_key", { p_lat: venue.latitude, p_lng: venue.longitude });
  await ctx.db.from("venue_map_renders").delete().eq("venue_id", id);

  const active = await must(ctx.db.from("meeting_spots").select("latitude, longitude").eq("venue_id", id).eq("active", true));
  const outcome = await renderVenueMap(
    ctx.env.MAPBOX_TOKEN,
    ctx.db as never,
    { ...venue, map_key: (key as string | null) ?? null },
    0,
    chooseZoom(venue, active),
  );
  return back(form, outcome.ok ? { ok: `Map fetched (${Math.round((outcome.bytes ?? 0) / 1024)} KB)` } : { err: outcome.error ?? "Fetching the map failed" });
};

// POST /admin/venues/:id
export const saveVenue: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const name = str(form, "name");
  if (!name) return back(form, { err: "Name is required" });
  const point = coords(form);
  if (typeof point === "string") return back(form, { err: point });
  const { error } = await ctx.db
    .from("venues")
    .update({ name, address: str(form, "address") || null, ...point })
    .eq("id", ctx.params.id);
  return back(form, error ? { err: error.message } : { ok: "Venue saved" });
};

// POST /admin/venues/:id/spots — a spot added by hand is approved at once.
export const addSpot: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const name = str(form, "name");
  if (!name) return back(form, { err: "Spot name is required" });
  const last = await must(
    ctx.db.from("meeting_spots").select("sort_order").eq("venue_id", ctx.params.id).order("sort_order", { ascending: false }).limit(1),
  );
  const point = coords(form);
  if (typeof point === "string") return back(form, { err: point });
  const { error } = await ctx.db.from("meeting_spots").insert({
    venue_id: ctx.params.id,
    name,
    description: str(form, "description") || null,
    sort_order: (last[0]?.sort_order ?? -1) + 1,
    ...point,
  });
  return back(form, error ? { err: error.message } : { ok: "Spot added" });
};

// POST /admin/spots/:id
export const saveSpot: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const name = str(form, "name");
  const order = Number(str(form, "sort_order") || "0");
  if (!name) return back(form, { err: "Spot name is required" });
  if (!Number.isInteger(order) || order < -1000 || order > 1000) return back(form, { err: "Order must be a whole number" });
  const point = coords(form);
  if (typeof point === "string") return back(form, { err: point });
  const walkRaw = str(form, "walk_minutes");
  const walk = walkRaw ? Number(walkRaw) : null;
  if (walk !== null && (!Number.isInteger(walk) || walk < 1 || walk > 60)) {
    return back(form, { err: "Walk must be a whole number of minutes, 1 to 60, or blank for automatic" });
  }
  const { error } = await ctx.db
    .from("meeting_spots")
    .update({
      name,
      description: str(form, "description") || null,
      sort_order: order,
      active: form.get("active") === "on",
      walk_minutes: walk,
      ...point,
    })
    .eq("id", ctx.params.id);
  return back(form, error ? { err: error.message } : { ok: "Spot saved" });
};

// POST /admin/suggestions/:id/approve — with the admin's edits, if any.
export const approveSuggestion: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_approve_spot", {
    p_suggestion: ctx.params.id,
    p_name: str(form, "name"),
    p_description: str(form, "description"),
    p_actor: ctx.email,
  });
  return back(form, error ? { err: error.message } : { ok: "Spot approved" });
};

export const rejectSuggestion: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_reject_spot", { p_suggestion: ctx.params.id, p_actor: ctx.email });
  return back(form, error ? { err: error.message } : { ok: "Suggestion rejected" });
};

export const addAlias: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const alias = str(form, "alias");
  if (!alias) return back(form, { err: "Alias is required" });
  const { error } = await ctx.db.from("venue_aliases").insert({ venue_id: ctx.params.id, alias });
  return back(form, error ? { err: error.message } : { ok: "Alias added" });
};

export const deleteAlias: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.from("venue_aliases").delete().eq("id", ctx.params.id);
  return back(form, error ? { err: error.message } : { ok: "Alias removed" });
};

export const addExternalId: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const source = str(form, "source");
  const externalId = str(form, "external_id");
  if (!["ticketmaster", "ai"].includes(source) || !externalId) return back(form, { err: "Source and id are required" });
  const { error } = await ctx.db
    .from("venue_external_ids")
    .insert({ venue_id: ctx.params.id, source, external_id: externalId });
  return back(form, error ? { err: error.message } : { ok: "External id added" });
};

export const deleteExternalId: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db
    .from("venue_external_ids")
    .delete()
    .eq("venue_id", ctx.params.id)
    .eq("source", str(form, "source"))
    .eq("external_id", str(form, "external_id"));
  return back(form, error ? { err: error.message } : { ok: "External id removed" });
};

// POST /admin/venues/:id/map — a new file name each time, so caches never serve the
// old map; the old file is then removed.
export const uploadMap: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const file = form.get("map");
  if (!file || typeof file === "string") return back(form, { err: "Choose an image file" });
  const ext = MAP_TYPES[file.type];
  if (!ext) return back(form, { err: "The map must be PNG, JPEG or WebP" });
  if (file.size > MAP_MAX_BYTES) return back(form, { err: "The map must be 2 MB or smaller" });

  const v = await must(ctx.db.from("venues").select("id, map_image_path").eq("id", ctx.params.id).maybeSingle());
  if (!v) return back(form, { err: "Venue not found" });
  const path = `${v.id}/map-${Date.now()}.${ext}`;
  const { error } = await ctx.db.storage
    .from(MAPS)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, cacheControl: "31536000" });
  if (error) return back(form, { err: error.message });
  await must(ctx.db.from("venues").update({ map_image_path: path }).eq("id", v.id));
  if (v.map_image_path) await ctx.db.storage.from(MAPS).remove([v.map_image_path]);
  return back(form, { ok: "Map uploaded" });
};
