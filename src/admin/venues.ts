// Venues, their curated meeting spots, AI-suggested spots awaiting approval,
// aliases and external ids for import matching, and the static map image.
//
// Map images go in the PUBLIC venue-maps bucket (decisions Part 5): a public building
// and its public spots, never a person (H1). Only this admin writes there.
import type { AdminHandler } from "./context";
import { adminPage, back, e, here, link, must, notFound, postButton, str } from "./ui";

const MAPS = "venue-maps";
const MAP_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAP_MAX_BYTES = 2 * 1024 * 1024;

// GET /admin/venues
export const venueList: AdminHandler = async (request, ctx) => {
  const venues = await must(
    ctx.db
      .from("venues")
      .select("id, name, city, address, map_image_path, meeting_spots(active), spot_suggestions(status)")
      .order("name"),
  );
  const rows = venues
    .map((v: any) => {
      const approved = (v.meeting_spots ?? []).filter((s: any) => s.active).length;
      const pending = (v.spot_suggestions ?? []).filter((s: any) => s.status === "pending").length;
      return `<tr><td><a href="/admin/venues/${e(v.id)}">${e(v.name)}</a></td><td>${e(v.city)}</td>
<td>${approved >= 3 ? `<span class="good">${approved} ✓</span>` : `<span class="bad">${approved} ✗</span>`}</td>
<td>${pending ? `<strong>${pending} to review</strong>` : ""}</td><td>${v.map_image_path ? "yes" : `<span class="bad">no</span>`}</td></tr>`;
    })
    .join("");
  const body = `<table><tr><th>Venue</th><th>City</th><th>Approved spots</th><th>AI suggestions</th><th>Map</th></tr>
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

// GET /admin/venues/:id
export const venueDetail: AdminHandler = async (request, ctx) => {
  const { db } = ctx;
  const id = ctx.params.id!;
  const v = await must(db.from("venues").select("*").eq("id", id).maybeSingle());
  if (!v) return notFound(request, ctx.email);
  const [spots, suggestions, aliases, externals] = await Promise.all([
    must(db.from("meeting_spots").select("*").eq("venue_id", id).order("sort_order").order("created_at")),
    must(db.from("spot_suggestions").select("*").eq("venue_id", id).eq("status", "pending").order("created_at")),
    must(db.from("venue_aliases").select("id, alias").eq("venue_id", id).order("alias")),
    must(db.from("venue_external_ids").select("source, external_id, needs_review").eq("venue_id", id)),
  ]);
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
    approved < 3
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
<p class="muted">City: ${e(v.city)}</p>
<button class="plain">Save venue</button></form>

<h2>Meeting spots — ${approved >= 3 ? `<span class="good">${approved} approved ✓</span>` : `<span class="bad">${approved} approved: needs 3 to publish</span>`}</h2>
<p class="muted">Curated public places only (H5). The spot poll uses the first 3 approved, by order.</p>
<table>${spotRows || `<tr><td class="muted">None yet.</td></tr>`}</table>
<form method="post" action="/admin/venues/${e(id)}/spots"><input type="hidden" name="back" value="${e(backTo)}">
<input name="name" required maxlength="80" size="24" placeholder="New spot name">
<input name="description" size="40" placeholder="description">
<button class="plain">Add spot</button></form>

<h2>AI-suggested spots awaiting approval (${suggestions.length})</h2>
<p class="muted">Not public until approved. Edit the name or description before approving if needed. Check the page each one links to.</p>
<table>${suggestionRows || `<tr><td class="muted">None pending.</td></tr>`}</table>
<p>${suggest}</p>

<h2>Static map image</h2>
<p class="muted">Public: the venue and its meeting spots, never people (H1). PNG, JPEG or WebP, up to 2 MB.</p>
${mapUrl ? `<p><img src="${e(mapUrl)}" alt="map" style="max-width:360px;border:1px solid #ccc"></p>` : `<p class="bad">No map yet.</p>`}
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

// POST /admin/venues/:id
export const saveVenue: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const name = str(form, "name");
  if (!name) return back(form, { err: "Name is required" });
  const { error } = await ctx.db
    .from("venues")
    .update({ name, address: str(form, "address") || null })
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
  const { error } = await ctx.db.from("meeting_spots").insert({
    venue_id: ctx.params.id,
    name,
    description: str(form, "description") || null,
    sort_order: (last[0]?.sort_order ?? -1) + 1,
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
  const { error } = await ctx.db
    .from("meeting_spots")
    .update({ name, description: str(form, "description") || null, sort_order: order, active: form.get("active") === "on" })
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
