// Admin pages: plain HTML forms, ugly on purpose. Private to Alex.
import { escape } from "../html";

export const e = (value: unknown): string => escape(value ?? "");

const CSS = `
body{margin:0;padding:16px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;background:#fff}
nav{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 16px;padding:0 0 10px;border-bottom:1px solid #ccc}
nav .who{margin-left:auto;color:#666}
h1{font-size:1.3rem;margin:0 0 12px}h2{font-size:1.05rem;margin:24px 0 8px}
a{color:#582883}
table{border-collapse:collapse;width:100%;margin:0 0 12px}
th,td{border-bottom:1px solid #ddd;padding:6px 8px 6px 0;text-align:left;vertical-align:top}
th{font-weight:600;color:#444}
form.inline{display:inline;margin:0 4px 0 0}
button,.button{padding:4px 10px;border:1px solid #582883;border-radius:4px;background:#582883;color:#fff;font:inherit;cursor:pointer;text-decoration:none}
button.plain{background:#fff;color:#582883}
button.danger{background:#fff;color:#b00020;border-color:#b00020}
input,select,textarea{font:inherit;padding:3px 4px;max-width:100%}
label{display:block;margin:0 0 8px}
fieldset{border:1px solid #ccc;margin:0 0 12px;padding:8px 10px}
.flash{padding:8px 10px;margin:0 0 12px;border-radius:4px}
.ok{background:#e8f5e9}.err{background:#fdecea;color:#b00020}
.muted{color:#666}.bad{color:#b00020}.good{color:#1b5e20}
.photo{width:160px;height:160px;object-fit:cover;background:#eee;display:block}
`;

const NAV: [string, string][] = [
  ["/admin", "Drafts"],
  ["/admin/published", "Published"],
  ["/admin/gatherings/new", "Add manually"],
  ["/admin/venues", "Venues"],
  ["/admin/photos", "Photos"],
  ["/admin/reports", "Reports"],
];

// Admin responses are never cached or indexed, never framed, and never send a
// referrer (photo pages carry short-lived signed links).
const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": "frame-ancestors 'none'",
};

// ?ok= / ?err= on the URL: the result of the action that redirected here.
export function adminPage(request: Request, email: string, title: string, body: string, status = 200): Response {
  const url = new URL(request.url);
  const ok = url.searchParams.get("ok");
  const err = url.searchParams.get("err");
  const flash =
    (ok ? `<p class="flash ok">${e(ok)}</p>` : "") + (err ? `<p class="flash err">${e(err)}</p>` : "");
  const nav = NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join("");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)} · Pin'd admin</title>
<style>${CSS}</style>
</head>
<body><nav>${nav}<span class="who">${e(email)} · staging</span></nav>${flash}<h1>${e(title)}</h1>${body}</body>
</html>`;
  return new Response(html, { status, headers: HEADERS });
}

export function forbidden(): Response {
  return new Response("<!doctype html><title>Forbidden</title><h1>403 Forbidden</h1>", {
    status: 403,
    headers: HEADERS,
  });
}

export function notFound(request: Request, email: string): Response {
  return adminPage(request, email, "Not found", "<p>No such admin page.</p>", 404);
}

// Only ever back into the admin: "back" must be an /admin path on this site.
function safeBack(value: string | null | undefined, fallback: string): string {
  if (value && /^\/admin(\/|$|\?)/.test(value) && !value.startsWith("//")) return value;
  return fallback;
}

// 303 back to the page the form came from, with the outcome shown at the top.
export function back(form: FormData | null, outcome: { ok?: string; err?: string }, fallback = "/admin"): Response {
  const target = new URL(safeBack(str(form, "back"), fallback), "https://x");
  target.searchParams.delete("ok");
  target.searchParams.delete("err");
  if (outcome.ok) target.searchParams.set("ok", outcome.ok);
  if (outcome.err) target.searchParams.set("err", outcome.err);
  return new Response(null, { status: 303, headers: { location: target.pathname + target.search, "cache-control": "no-store" } });
}

export function str(form: FormData | null, name: string): string {
  const v = form?.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A one-button form that POSTs to `action` and comes back to `backTo`.
export function postButton(
  action: string,
  label: string,
  backTo: string,
  opts: { fields?: Record<string, string>; cls?: string; confirm?: string } = {},
): string {
  const fields = Object.entries(opts.fields ?? {})
    .map(([k, v]) => `<input type="hidden" name="${e(k)}" value="${e(v)}">`)
    .join("");
  const onsubmit = opts.confirm ? ` onsubmit="return confirm(${e(JSON.stringify(opts.confirm))})"` : "";
  return `<form class="inline" method="post" action="${e(action)}"${onsubmit}>${fields}<input type="hidden" name="back" value="${e(backTo)}"><button class="${e(opts.cls ?? "")}">${e(label)}</button></form>`;
}

// The current page's path and query, minus the flash — used as `back`.
export function here(request: Request): string {
  const url = new URL(request.url);
  url.searchParams.delete("ok");
  url.searchParams.delete("err");
  return url.pathname + url.search;
}

// Supabase embeds a one-to-one relation as an object or a one-element array.
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// A link only when it is http(s); anything else is shown as text.
export function link(url: string | null | undefined, label?: string): string {
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) return e(url);
  return `<a href="${e(url)}" rel="noreferrer noopener" target="_blank">${e(label ?? url)}</a>`;
}

// A database error on an admin page: shown to the admin as-is (this page is only
// for Alex), never on a public page.
export class AdminError extends Error {}

// Untyped on purpose, like the policy harness: this repo has no generated database
// types, and admin pages check for missing rows themselves.
export async function must(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<any> {
  const { data, error } = await query;
  if (error) throw new AdminError(error.message);
  return data;
}
