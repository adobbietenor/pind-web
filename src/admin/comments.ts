// A16's comments (#10; Alex, 14 Oct 2026 — decisions, "A16's comment box").
//
// A comment may describe a person, and until A24's report-from-a-profile exists (M3.5)
// it is the only free-text way one can reach us from inside the app. So the admin page is
// enough for the first crowds on two conditions (Alex): **an unread count on every admin
// page** — an unread pile is a number somewhere, never invisible — and comments on M4.1's
// rota at the reports' standard, "by 10 a.m. someone has looked".
//
// Whether a comment has been read lives in survey_comment_reads, which only the service
// key can touch: the person who wrote it never learns whether anyone has (P207).
import type { AdminContext, AdminHandler } from "./context";
import { navWithUnread } from "./navcount";
import { adminPage, back, e, here, must, postButton } from "./ui";

const ANSWER: Record<string, string> = {
  yes: "Yes",
  no: "No",
  wasnt_going: "I wasn't going to go at all",
};

// GET /admin/comments — unread first, then the rest, newest first.
export const commentQueue: AdminHandler = async (request, ctx) => {
  const rows = (await must(ctx.db.rpc("admin_comments", { p_limit: 200 }))) as {
    id: string;
    gathering_id: string;
    gathering_name: string;
    starts_at: string;
    first_name: string | null;
    would_have_gone: string;
    comment: string;
    created_at: string;
    read_at: string | null;
    read_by: string | null;
  }[];
  const unread = rows.filter((r) => !r.read_at);
  const backTo = here(request);
  const when = (iso: string) => e(iso.slice(0, 16).replace("T", " ")) + " UTC";
  const row = (r: (typeof rows)[number]) => `<tr><td>
<strong>${e(r.first_name ?? "?")}</strong> · <a href="/admin/gatherings/${e(r.gathering_id)}">${e(r.gathering_name)}</a> · ${when(r.created_at)}<br>
<span class="muted">Would they have gone alone anyway? ${e(ANSWER[r.would_have_gone] ?? r.would_have_gone)}</span>
<p style="white-space:pre-wrap;margin:6px 0">${e(r.comment)}</p></td>
<td>${r.read_at ? `<span class="muted">read by ${e(r.read_by)}<br>${when(r.read_at)}</span>` : postButton(`/admin/comments/${r.id}/read`, "Mark read", backTo)}</td></tr>`;

  const body = `<p class="muted">After the night, A16 asks one question and offers an optional comment. Only the person who wrote it and people at Pin'd can read a comment; it is deleted with their account.
On the moderation rota at the same standard as reports: by 10 a.m. someone has looked. Anything about a person is a safety report — act on it from <a href="/admin/reports">Reports</a>.</p>
<h2>Unread (${unread.length})</h2>
<table>${unread.map(row).join("") || `<tr><td class="muted">None.</td></tr>`}</table>
<h2>Read</h2>
<table>${rows.filter((r) => r.read_at).map(row).join("") || `<tr><td class="muted">None.</td></tr>`}</table>`;
  return adminPage(request, ctx.email, `Comments (${unread.length} unread)`, body);
};

// POST /admin/comments/:id/read
export const markCommentRead: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_comment_read", { p_actor: ctx.email, p_response: ctx.params.id });
  return back(form, error ? { err: error.message } : { ok: "Marked read" }, "/admin/comments");
};

// Every admin page's nav says how many comments are unread. A count that cannot be read
// says so, rather than vanishing: a pile nobody can see is the failure this exists for.
export async function withUnreadComments(response: Response, ctx: AdminContext): Promise<Response> {
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.startsWith("text/html")) return response;
  const html = await response.text();
  const { data, error } = await ctx.db.rpc("admin_unread_comments");
  return new Response(navWithUnread(html, error ? null : Number(data)), { status: response.status, headers: response.headers });
}
