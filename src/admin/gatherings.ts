// Draft queue, published list, manual add, gathering edit, lifecycle actions, pins,
// CSV export. Lifecycle changes go through the admin_* database functions, which
// enforce the rules (3 approved spots to publish, zero pins to unpublish) and write
// the moderation log (decisions.md Part 5, docs/visibility.md V11/V12).
import type { AdminHandler } from "./context";
import { toCsv } from "./csv";
import { places, venueOptions, type Places } from "./places";
import { formatLocal, fromLocalInput, localDate, toLocalInput } from "./time";
import { adminPage, back, e, here, link, must, notFound, one, postButton, str, UUID } from "./ui";

const HOUR = 60 * 60 * 1000;

interface Counts {
  pinned: number;
  open_to_meeting: number;
  crews_open: boolean;
}

async function counts(ctx: Parameters<AdminHandler>[1], ids: string[]): Promise<Map<string, Counts>> {
  if (!ids.length) return new Map();
  const rows = await must(ctx.db.rpc("gathering_counts", { gathering_ids: ids }));
  return new Map((rows as (Counts & { gathering_id: string })[]).map((r) => [r.gathering_id, r]));
}

function sourcesOf(g: { source: string; gathering_sources?: { source: string }[] }): string {
  return [...new Set([g.source, ...(g.gathering_sources ?? []).map((s) => s.source)])].join(" + ");
}

function spotsBadge(p: Places, venueId: string | null): string {
  const n = p.spots(venueId);
  return n >= 3 ? `<span class="good">${n}/3 ✓</span>` : `<span class="bad">${n}/3 ✗</span>`;
}

function venueCell(p: Places, g: { venue_id: string | null; venue_name_raw: string | null }): string {
  const v = g.venue_id ? p.byId.get(g.venue_id) : null;
  if (v) return `<a href="/admin/venues/${e(v.id)}">${e(v.name)}</a>`;
  return `<span class="bad">unmatched</span>${g.venue_name_raw ? `: ${e(g.venue_name_raw)}` : ""}`;
}

// Same day (in the venue's zone) and same venue — or the same raw venue name.
function dupKey(p: Places, g: { starts_at: string; venue_id: string | null; venue_name_raw: string | null }): string {
  const where = g.venue_id ?? `raw:${(g.venue_name_raw ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;
  return `${localDate(g.starts_at, p.tz(g.venue_id))}|${where}`;
}

// ---------------------------------------------------------------------------
// GET /admin — the draft queue, by date
// ---------------------------------------------------------------------------

export const draftQueue: AdminHandler = async (request, ctx) => {
  const { db } = ctx;
  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * HOUR).toISOString();
  const [drafts, upcoming, dismissed, recent, p] = await Promise.all([
    must(
      db
        .from("gatherings")
        .select(
          "id, name, starts_at, is_free, source, venue_id, venue_name_raw, event_url, gathering_sources(source, urls), gathering_triage(score, reason)",
        )
        .eq("status", "draft")
        .gt("starts_at", now)
        .order("starts_at"),
    ),
    must(
      db
        .from("gatherings")
        .select("id, name, starts_at, status, venue_id, venue_name_raw")
        .neq("status", "dismissed")
        .gt("starts_at", now)
        .order("starts_at"),
    ),
    must(
      db
        .from("gatherings")
        .select("id, name, starts_at, source, venue_id")
        .eq("status", "dismissed")
        .is("merged_into_id", null)
        .gt("starts_at", now)
        .order("dismissed_at", { ascending: false })
        .limit(20),
    ),
    db.from("gatherings").select("id", { count: "exact", head: true }).gte("published_at", weekAgo),
    places(db),
  ]);

  const byDay = new Map<string, any[]>();
  const byKey = new Map<string, any[]>();
  for (const g of upcoming) {
    const day = localDate(g.starts_at, p.tz(g.venue_id));
    byDay.set(day, [...(byDay.get(day) ?? []), g]);
    const key = dupKey(p, g);
    byKey.set(key, [...(byKey.get(key) ?? []), g]);
  }

  const backTo = here(request);
  const rows = drafts
    .map((g: any) => {
      const tz = p.tz(g.venue_id);
      const triage = one<{ score: number | null; reason: string | null }>(g.gathering_triage);
      const urls = (g.gathering_sources ?? []).flatMap((s: { urls: string[] }) => s.urls ?? []);
      const dups = (byKey.get(dupKey(p, g)) ?? []).filter((o: any) => o.id !== g.id);
      const candidates = (byDay.get(localDate(g.starts_at, tz)) ?? []).filter((o: any) => o.id !== g.id);
      const merge = candidates.length
        ? `<form class="inline" method="post" action="/admin/gatherings/${e(g.id)}/merge">` +
          `<input type="hidden" name="back" value="${e(backTo)}"><select name="into">` +
          candidates
            .map((o: any) => `<option value="${e(o.id)}"${dups.some((d: any) => d.id === o.id) ? " selected" : ""}>${e(o.name)} (${e(o.status)})</option>`)
            .join("") +
          `</select> <button class="plain">Merge into</button></form>`
        : "";
      return `<tr>
<td>${e(formatLocal(g.starts_at, tz))}</td>
<td><strong>${e(g.name)}</strong>${dups.length ? `<br><span class="bad">Possible duplicate of: ${dups.map((d: any) => e(d.name)).join(", ")}</span>` : ""}
<br>${[link(g.event_url, "event link"), ...urls.map((u: string, i: number) => link(u, `source ${i + 1}`))].filter(Boolean).join(" · ")}</td>
<td>${venueCell(p, g)}</td>
<td>${e(sourcesOf(g))}</td>
<td>${triage?.score ?? "—"}<br><span class="muted">${e(triage?.reason ?? "")}</span></td>
<td>${g.is_free ? "free" : "ticketed"}</td>
<td>${spotsBadge(p, g.venue_id)}</td>
<td>${postButton(`/admin/gatherings/${g.id}/publish`, "Publish", backTo)}
${postButton(`/admin/gatherings/${g.id}/dismiss`, "Dismiss", backTo, { cls: "plain" })}
<a href="/admin/gatherings/${e(g.id)}">Edit</a><br>${merge}</td>
</tr>`;
    })
    .join("");

  const dismissedRows = dismissed
    .map(
      (g: any) =>
        `<tr><td>${e(formatLocal(g.starts_at, p.tz(g.venue_id)))}</td><td>${e(g.name)}</td><td>${e(g.source)}</td><td>${postButton(`/admin/gatherings/${g.id}/restore`, "Restore", backTo, { cls: "plain" })}</td></tr>`,
    )
    .join("");

  const body = `
<p>Published in the last 7 days: <strong>${recent.count ?? 0}</strong>. Publish a handful: pins must concentrate so crowds reach 5.</p>
<p class="muted">A gathering can be published only when its venue has 3 approved meeting spots.</p>
<table>
<tr><th>When</th><th>Gathering</th><th>Venue</th><th>Source</th><th>AI score</th><th>Entry</th><th>Spots</th><th></th></tr>
${rows || `<tr><td colspan="8">No upcoming drafts.</td></tr>`}
</table>
<h2>Recently dismissed</h2>
<table><tr><th>When</th><th>Gathering</th><th>Source</th><th></th></tr>${dismissedRows || `<tr><td colspan="4" class="muted">None.</td></tr>`}</table>`;
  return adminPage(request, ctx.email, `Draft queue (${drafts.length})`, body);
};

// ---------------------------------------------------------------------------
// GET /admin/published
// ---------------------------------------------------------------------------

export const publishedList: AdminHandler = async (request, ctx) => {
  const since = new Date(Date.now() - 2 * 24 * HOUR).toISOString();
  const [list, p] = await Promise.all([
    must(
      ctx.db
        .from("gatherings")
        .select("id, name, starts_at, venue_id, is_free")
        .eq("status", "published")
        .gt("starts_at", since)
        .order("starts_at"),
    ),
    places(ctx.db),
  ]);
  const c = await counts(ctx, list.map((g: any) => g.id));
  const rows = list
    .map((g: any) => {
      const n = c.get(g.id);
      return `<tr><td>${e(formatLocal(g.starts_at, p.tz(g.venue_id)))}</td>
<td><a href="/admin/gatherings/${e(g.id)}">${e(g.name)}</a></td><td>${venueCell(p, { ...g, venue_name_raw: null })}</td>
<td>${n?.pinned ?? 0}</td><td>${n?.open_to_meeting ?? 0}${n?.crews_open ? " · crews open" : ""}</td>
<td><a href="/admin/gatherings/${e(g.id)}/export.csv">CSV</a></td></tr>`;
    })
    .join("");
  const body = `<table><tr><th>When</th><th>Gathering</th><th>Venue</th><th>Pinned</th><th>Open to meeting</th><th></th></tr>
${rows || `<tr><td colspan="6">Nothing published.</td></tr>`}</table>`;
  return adminPage(request, ctx.email, "Published", body);
};

// ---------------------------------------------------------------------------
// Shared form fields
// ---------------------------------------------------------------------------

interface GatheringFields {
  name: string;
  starts_at: string;
  ends_at: string | null;
  event_url: string | null;
  is_free: boolean;
  featured: boolean;
  venue_name_raw: string | null;
}

function readFields(form: FormData, tz: string): GatheringFields | string {
  const name = str(form, "name");
  if (!name || name.length > 200) return "Name is required (up to 200 characters)";
  const starts = fromLocalInput(str(form, "starts_at"), tz);
  if (!starts) return "Start time is required";
  const endsRaw = str(form, "ends_at");
  const ends = endsRaw ? fromLocalInput(endsRaw, tz) : null;
  if (endsRaw && !ends) return "End time is not a valid date and time";
  if (ends && Date.parse(ends) <= Date.parse(starts)) return "End time must be after the start";
  const eventUrl = str(form, "event_url");
  if (eventUrl && !/^https?:\/\/\S+$/i.test(eventUrl)) return "Event link must start with http:// or https://";
  return {
    name,
    starts_at: starts,
    ends_at: ends,
    event_url: eventUrl || null,
    is_free: form.get("is_free") === "on",
    featured: form.get("featured") === "on",
    venue_name_raw: str(form, "venue_name_raw") || null,
  };
}

function fieldsHtml(p: Places, g: any, lockVenue: boolean): string {
  const tz = p.tz(g?.venue_id);
  const venue = lockVenue
    ? `<label>Venue: <strong>${e(p.byId.get(g.venue_id)?.name ?? "")}</strong> <span class="muted">(fixed once published)</span></label>`
    : `<label>Venue<br><select name="venue_id">${venueOptions(p, g?.venue_id)}</select></label>`;
  return `
<label>Name<br><input name="name" required maxlength="200" size="60" value="${e(g?.name)}"></label>
<label>Starts (venue's local time, ${e(tz)})<br><input type="datetime-local" name="starts_at" required value="${e(toLocalInput(g?.starts_at, tz))}"></label>
<label>Ends (optional; festivals and club nights)<br><input type="datetime-local" name="ends_at" value="${e(toLocalInput(g?.ends_at, tz))}"></label>
${venue}
<label>Venue name from the source<br><input name="venue_name_raw" size="40" value="${e(g?.venue_name_raw)}"></label>
<label>Event link (tickets or event info, optional)<br><input name="event_url" size="60" value="${e(g?.event_url)}"></label>
<label><input type="checkbox" name="is_free"${g?.is_free ? " checked" : ""}> Free event (button reads "Pin in — I'm going")</label>
<label><input type="checkbox" name="featured"${g?.featured ? " checked" : ""}> Featured</label>`;
}

// ---------------------------------------------------------------------------
// Manual add — the fallback. Creates a draft; it is published from the queue.
// ---------------------------------------------------------------------------

export const newGatheringForm: AdminHandler = async (request, ctx) => {
  const p = await places(ctx.db);
  const body = `<p class="muted">Fallback only: most gatherings arrive from Ticketmaster or the AI run. This creates a draft; publish it from the queue.
Times are read in the chosen venue's timezone (Toronto if no venue).</p>
<form method="post" action="/admin/gatherings/new"><input type="hidden" name="back" value="/admin/gatherings/new">
${fieldsHtml(p, null, false)}
<button>Create draft</button></form>`;
  return adminPage(request, ctx.email, "Add a gathering manually", body);
};

export const createGathering: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const p = await places(ctx.db);
  const venueId = str(form, "venue_id") || null;
  if (venueId && !p.byId.has(venueId)) return back(form, { err: "Unknown venue" });
  const fields = readFields(form, p.tz(venueId));
  if (typeof fields === "string") return back(form, { err: fields });
  const { data, error } = await ctx.db
    .from("gatherings")
    .insert({ ...fields, venue_id: venueId, source: "manual" })
    .select("id")
    .single();
  if (error) return back(form, { err: error.message });
  return back(null, { ok: "Draft created. Publish it from the queue when ready." }, `/admin/gatherings/${data.id}`);
};

// ---------------------------------------------------------------------------
// GET /admin/gatherings/:id — edit, spot poll, WhatsApp links, counts and pins
// ---------------------------------------------------------------------------

export const editGathering: AdminHandler = async (request, ctx) => {
  const { db } = ctx;
  const id = ctx.params.id!;
  const g = await must(
    db
      .from("gatherings")
      .select(
        "*, gathering_sources(source, external_id, urls, last_seen_at), gathering_triage(score, reason), gathering_group_links(kind, url), gathering_spots(id, spot_id, meet_at)",
      )
      .eq("id", id)
      .maybeSingle(),
  );
  if (!g) return notFound(request, ctx.email);
  const p = await places(db);
  const tz = p.tz(g.venue_id);
  const backTo = here(request);
  const published = g.status === "published";

  const venueSpots = g.venue_id
    ? await must(
        db.from("meeting_spots").select("id, name, active").eq("venue_id", g.venue_id).order("sort_order").order("created_at"),
      )
    : [];
  const options = [...(g.gathering_spots ?? [])].sort(
    (a: any, b: any) => a.meet_at.localeCompare(b.meet_at) || a.id.localeCompare(b.id),
  );
  const pollRows = [0, 1, 2]
    .map((i) => {
      const row = options[i];
      const select = venueSpots
        .filter((s: any) => s.active || s.id === row?.spot_id)
        .map((s: any) => `<option value="${e(s.id)}"${s.id === row?.spot_id ? " selected" : ""}>${e(s.name)}</option>`)
        .join("");
      return `<tr><td>${i + 1}</td>
<td><input type="hidden" name="spot_${i}_row" value="${e(row?.id)}"><select name="spot_${i}"><option value="">—</option>${select}</select></td>
<td><input type="datetime-local" name="spot_${i}_at" value="${e(toLocalInput(row?.meet_at, tz))}"></td></tr>`;
    })
    .join("");
  const linkOf = (kind: string) => (g.gathering_group_links ?? []).find((l: any) => l.kind === kind)?.url ?? "";

  const triage = one<{ score: number | null; reason: string | null }>(g.gathering_triage);
  const sources = (g.gathering_sources ?? [])
    .map(
      (s: any) =>
        `<li>${e(s.source)}${s.external_id ? ` · ${e(s.external_id)}` : ""} · ${(s.urls ?? []).map((u: string) => link(u)).join(", ")}</li>`,
    )
    .join("");

  let actions = "";
  if (g.status === "draft") {
    actions =
      postButton(`/admin/gatherings/${id}/publish`, "Publish", backTo) +
      postButton(`/admin/gatherings/${id}/dismiss`, "Dismiss", backTo, { cls: "plain" });
  } else if (published) {
    actions = postButton(`/admin/gatherings/${id}/unpublish`, "Unpublish (only with zero pins)", backTo, {
      cls: "danger",
      confirm: "Unpublish? Only possible while nobody has pinned in.",
    });
  } else if (!g.merged_into_id) {
    actions = postButton(`/admin/gatherings/${id}/restore`, "Restore to draft", backTo, { cls: "plain" });
  } else {
    actions = `Merged into <a href="/admin/gatherings/${e(g.merged_into_id)}">another gathering</a>.`;
  }

  const pinsSection = published ? await pinsHtml(request, ctx, id, backTo) : "";

  const body = `
<p>Status: <strong>${e(g.status)}</strong> · origin: ${e(g.source)} · venue spots ${spotsBadge(p, g.venue_id)} ${actions}</p>
${triage ? `<p>AI score <strong>${triage.score ?? "—"}</strong> — ${e(triage.reason ?? "")}</p>` : ""}
${sources ? `<ul>${sources}</ul>` : ""}
<form method="post" action="/admin/gatherings/${e(id)}"><input type="hidden" name="back" value="${e(backTo)}">
<fieldset><legend>Gathering</legend>${fieldsHtml(p, g, published)}</fieldset>
<fieldset><legend>Spot poll (3 options)</legend>
<p class="muted">Filled automatically at publish from the venue's first 3 approved spots, at start minus 60 minutes. Change them here.
Changing the venue of a draft clears these.</p>
<table><tr><th></th><th>Spot</th><th>Meet at</th></tr>${pollRows}</table></fieldset>
<fieldset><legend>WhatsApp groups (shown only per the visibility rules)</legend>
<label>Main group link<br><input name="wa_everyone" size="60" placeholder="https://chat.whatsapp.com/…" value="${e(linkOf("everyone"))}"></label>
<label>Women-only group link<br><input name="wa_women_only" size="60" placeholder="https://chat.whatsapp.com/…" value="${e(linkOf("women_only"))}"></label>
</fieldset>
<button>Save</button></form>
${pinsSection}`;
  return adminPage(request, ctx.email, g.name, body);
};

async function pinsHtml(request: Request, ctx: Parameters<AdminHandler>[1], id: string, backTo: string): Promise<string> {
  const [c, pins] = await Promise.all([
    counts(ctx, [id]),
    must(
      ctx.db
        .from("pins")
        .select(
          "id, party_total, open_to_meeting, created_at, person_id, people(first_name, instagram_handle, neighbourhood, photo_status, photo_path, hidden_at)",
        )
        .eq("gathering_id", id)
        .order("created_at"),
    ),
  ]);
  const n = c.get(id);
  const rows = pins
    .map((pin: any) => {
      const person = one<any>(pin.people) ?? {};
      return `<tr><td>${e(person.first_name)}</td><td>${e(person.instagram_handle ?? "")}</td><td>${e(person.neighbourhood ?? "")}</td>
<td>${pin.party_total}</td><td>${pin.open_to_meeting ? "yes" : "no"}</td>
<td>${person.photo_path ? e(person.photo_status) : "no photo"}</td><td>${person.hidden_at ? `<span class="bad">hidden</span>` : ""}</td>
<td>${e(new Date(pin.created_at).toISOString().slice(0, 16).replace("T", " "))} UTC</td>
<td>${postButton(`/admin/pins/${pin.id}/delete`, "Delete pin", backTo, {
        cls: "danger",
        confirm: `Delete ${person.first_name ?? "this person"}'s pin? This cannot be undone.`,
      })}</td></tr>`;
    })
    .join("");
  return `<h2>Counts</h2>
<p>Pinned <strong>${n?.pinned ?? 0}</strong> · open to meeting <strong>${n?.open_to_meeting ?? 0}</strong>${n?.crews_open ? " · crews open" : ""}
· <a href="/admin/gatherings/${e(id)}/export.csv">Download CSV</a></p>
<h2>Pins (${pins.length})</h2>
<table><tr><th>First name</th><th>Instagram</th><th>Neighbourhood</th><th>Party</th><th>Open</th><th>Photo</th><th></th><th>Pinned</th><th></th></tr>
${rows || `<tr><td colspan="9">No pins yet.</td></tr>`}</table>`;
}

// POST /admin/gatherings/:id
export const saveGathering: AdminHandler = async (request, ctx) => {
  const { db } = ctx;
  const id = ctx.params.id!;
  const form = await request.formData();
  const current = await must(db.from("gatherings").select("id, venue_id, published_at").eq("id", id).maybeSingle());
  if (!current) return back(form, { err: "Gathering not found" });
  const p = await places(db);
  const published = current.published_at !== null;
  const venueId = published ? current.venue_id : str(form, "venue_id") || null;
  if (venueId && !p.byId.has(venueId)) return back(form, { err: "Unknown venue" });
  const tz = p.tz(venueId);
  const fields = readFields(form, tz);
  if (typeof fields === "string") return back(form, { err: fields });

  const wa: Record<string, string> = { everyone: str(form, "wa_everyone"), women_only: str(form, "wa_women_only") };
  for (const url of Object.values(wa)) {
    if (url && !/^https:\/\/chat\.whatsapp\.com\/\S+$/.test(url)) {
      return back(form, { err: "WhatsApp links must start with https://chat.whatsapp.com/" });
    }
  }

  const { error } = await db.from("gatherings").update({ ...fields, venue_id: venueId }).eq("id", id);
  if (error) return back(form, { err: error.message });

  if (!published && venueId !== current.venue_id) {
    // The old spot options belong to the old venue.
    await must(db.from("gathering_spots").delete().eq("gathering_id", id));
  } else if (venueId) {
    const allowed = new Set(
      (await must(db.from("meeting_spots").select("id").eq("venue_id", venueId))).map((s: { id: string }) => s.id),
    );
    const defaultAt = new Date(Date.parse(fields.starts_at) - HOUR).toISOString();
    for (const i of [0, 1, 2]) {
      const rowId = str(form, `spot_${i}_row`);
      const spotId = str(form, `spot_${i}`);
      const at = str(form, `spot_${i}_at`);
      if (rowId && !UUID.test(rowId)) return back(form, { err: "Bad spot row" });
      if (spotId) {
        if (!allowed.has(spotId)) return back(form, { err: "That spot is not at this venue" });
        const meetAt = at ? fromLocalInput(at, tz) : defaultAt;
        if (!meetAt) return back(form, { err: `Spot ${i + 1}: meet time is not valid` });
        const write = rowId
          ? db.from("gathering_spots").update({ spot_id: spotId, meet_at: meetAt }).eq("id", rowId).eq("gathering_id", id)
          : db.from("gathering_spots").insert({ gathering_id: id, spot_id: spotId, meet_at: meetAt });
        const { error: spotError } = await write;
        if (spotError) return back(form, { err: `Spot ${i + 1}: ${spotError.message}` });
      } else if (rowId) {
        if (published) return back(form, { err: "A published gathering keeps its 3 spot options" });
        await must(db.from("gathering_spots").delete().eq("id", rowId).eq("gathering_id", id));
      }
    }
  }

  for (const [kind, url] of Object.entries(wa)) {
    const q = url
      ? db.from("gathering_group_links").upsert({ gathering_id: id, kind, url }, { onConflict: "gathering_id,kind" })
      : db.from("gathering_group_links").delete().eq("gathering_id", id).eq("kind", kind);
    const { error: linkError } = await q;
    if (linkError) return back(form, { err: linkError.message });
  }
  return back(form, { ok: "Saved" });
};

// ---------------------------------------------------------------------------
// Lifecycle actions — each one database function, logged with the admin's email
// ---------------------------------------------------------------------------

function lifecycle(fn: string, done: string): AdminHandler {
  return async (request, ctx) => {
    const form = await request.formData();
    const { error } = await ctx.db.rpc(fn, { p_gathering: ctx.params.id, p_actor: ctx.email });
    return back(form, error ? { err: error.message } : { ok: done });
  };
}

export const publishGathering = lifecycle("admin_publish_gathering", "Published");
export const unpublishGathering = lifecycle("admin_unpublish_gathering", "Unpublished: back to draft");
export const dismissGathering = lifecycle("admin_dismiss_gathering", "Dismissed");
export const restoreGathering = lifecycle("admin_restore_gathering", "Restored to draft");

// Merging cannot be undone with Restore, and the queue pre-selects a likely
// duplicate, so the first POST only shows a confirmation page naming both events.
// Nothing changes until "Confirm merge" posts again with confirm=yes.
export const mergeGathering: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const into = str(form, "into");
  if (!UUID.test(into)) return back(form, { err: "Choose a gathering to merge into" });

  if (str(form, "confirm") !== "yes") {
    const [pair, p] = await Promise.all([
      must(
        ctx.db
          .from("gatherings")
          .select("id, name, starts_at, status, source, venue_id, venue_name_raw, event_url, gathering_sources(source)")
          .in("id", [ctx.params.id!, into]),
      ),
      places(ctx.db),
    ]);
    const loser = pair.find((x: any) => x.id === ctx.params.id);
    const survivor = pair.find((x: any) => x.id === into);
    if (!loser || !survivor) return back(form, { err: "Gathering not found" });
    const describe = (x: any) => `<td><strong>${e(x.name)}</strong><br>${e(formatLocal(x.starts_at, p.tz(x.venue_id)))}
<br>${venueCell(p, x)}<br>source: ${e(sourcesOf(x))} · ${e(x.status)}<br>${link(x.event_url, "event link")}</td>`;
    const backTo = str(form, "back") || "/admin";
    const body = `<p><strong>Merge "${e(loser.name)}" into "${e(survivor.name)}"?</strong></p>
<p class="bad">This can't be undone with Restore. The first event is dismissed for good; its source records move to the second,
so future imports of it land on the second.</p>
<table><tr><th>Dismissed (merged away)</th><th>Kept</th></tr><tr>${describe(loser)}${describe(survivor)}</tr></table>
<form class="inline" method="post" action="/admin/gatherings/${e(loser.id)}/merge">
<input type="hidden" name="into" value="${e(survivor.id)}"><input type="hidden" name="confirm" value="yes">
<input type="hidden" name="back" value="${e(backTo)}"><button class="danger">Confirm merge</button></form>
<a href="${e(backTo.startsWith("/admin") ? backTo : "/admin")}">Cancel</a>`;
    return adminPage(request, ctx.email, "Confirm merge", body);
  }

  const { error } = await ctx.db.rpc("admin_merge_gatherings", {
    p_loser: ctx.params.id,
    p_survivor: into,
    p_actor: ctx.email,
  });
  return back(form, error ? { err: error.message } : { ok: "Merged: the duplicate is dismissed and its sources moved" });
};

// POST /admin/pins/:id/delete — on request.
export const deletePin: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_delete_pin", {
    p_pin: ctx.params.id,
    p_actor: ctx.email,
    p_note: str(form, "note") || null,
  });
  return back(form, error ? { err: error.message } : { ok: "Pin deleted" });
};

// ---------------------------------------------------------------------------
// GET /admin/gatherings/:id/export.csv — one row per pin. No contact details and no
// gender (Alex, M1.2).
// ---------------------------------------------------------------------------

export const exportCsv: AdminHandler = async (request, ctx) => {
  const { db } = ctx;
  const id = ctx.params.id!;
  const g = await must(db.from("gatherings").select("id, name, starts_at, venue_id").eq("id", id).maybeSingle());
  if (!g) return notFound(request, ctx.email);
  const [p, pins, surveys, hoods] = await Promise.all([
    places(db),
    must(
      db
        .from("pins")
        .select("party_total, open_to_meeting, created_at, person_id, people(first_name, neighbourhood, photo_path, instagram_handle, hidden_at)")
        .eq("gathering_id", id)
        .order("created_at"),
    ),
    must(db.from("survey_responses").select("person_id, met, would_have_gone").eq("gathering_id", id)),
    must(db.from("neighbourhoods").select("slug, name")),
  ]);
  const tz = p.tz(g.venue_id);
  const hoodName = new Map<string, string>(hoods.map((h: { slug: string; name: string }) => [h.slug, h.name]));
  const survey = new Map<string, { met: string; would_have_gone: string }>(
    surveys.map((s: any) => [s.person_id, s]),
  );
  const yes = (b: boolean) => (b ? "yes" : "no");
  const rows: unknown[][] = [
    [
      "gathering",
      "gathering_starts",
      "pinned_at",
      "first_name",
      "neighbourhood",
      "party_total",
      "open_to_meeting",
      "has_photo",
      "has_instagram",
      "hidden",
      "survey_met",
      "survey_would_have_gone",
    ],
    ...pins.map((pin: any) => {
      const person = one<any>(pin.people) ?? {};
      const s = survey.get(pin.person_id);
      return [
        g.name,
        toLocalInput(g.starts_at, tz).replace("T", " "),
        toLocalInput(pin.created_at, tz).replace("T", " "),
        person.first_name,
        person.neighbourhood ? (hoodName.get(person.neighbourhood) ?? person.neighbourhood) : "",
        pin.party_total,
        yes(pin.open_to_meeting),
        yes(!!person.photo_path),
        yes(!!person.instagram_handle),
        yes(!!person.hidden_at),
        s?.met ?? "",
        s?.would_have_gone ?? "",
      ];
    }),
  ];
  const file = `pind-${localDate(g.starts_at, tz)}-${g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}.csv`;
  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
};
