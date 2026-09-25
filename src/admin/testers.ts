// The testers page (M3.2): who may see seed rows while signed in, and the test crowd
// they walk. The list is written only here, with the service key (`admin_set_tester`);
// nobody can add themselves (P97). On M4.2's review list as a V18 change.

import type { AdminHandler } from "./context";
import { rasterise } from "../public/ogpng";
import { pinCookie, seal } from "../public/sealed";
import { projectUrl } from "../supabase";
import { buildTestCrowd, testCrowdStatus } from "./testcrowd";
import { adminPage, back, e, str, UUID } from "./ui";

export const testersPage: AdminHandler = async (request, ctx) => {
  const { data: testers, error } = await ctx.db.rpc("admin_testers");
  if (error) throw new Error(error.message);
  const crowd = await testCrowdStatus(ctx.db);
  const rows = ((testers ?? []) as { auth_user_id: string; email: string | null; added_at: string; added_by: string }[])
    .map(
      (t) => `<tr><td>${e(t.email ?? t.auth_user_id)}</td><td>${e(t.added_at.slice(0, 10))}</td><td>${e(t.added_by)}</td>
<td><form method="post" action="/admin/testers/${e(t.auth_user_id)}/remove"><input type="hidden" name="back" value="/admin/testers"><button>Remove</button></form></td></tr>`,
    )
    .join("");
  const { data: anonData } = await ctx.db.rpc("admin_anonymous_testers");
  const anon = (anonData ?? []) as { auth_user_id: string; added_at: string; still_anonymous: boolean; email: string | null; first_name: string | null }[];
  // Every session this button made, so none sits forgotten in a browser (Alex). A
  // still-anonymous one can be cleared here, and the nightly job clears any left for
  // three days; one that finished A27 is a permanent account, listed above.
  const anonRows = anon.length
    ? `<table><tr><th>Started</th><th>Now</th><th></th></tr>${anon
        .map(
          (a) => `<tr><td>${e(a.added_at.slice(0, 16).replace("T", " "))}</td><td>${
            a.still_anonymous ? `anonymous${a.first_name ? ` · pinned as ${e(a.first_name)}` : ""}` : `permanent · ${e(a.email ?? "")}`
          }</td><td>${
            a.still_anonymous
              ? `<form method="post" action="/admin/testers/anonymous/${e(a.auth_user_id)}/clear"><input type="hidden" name="back" value="/admin/testers"><button>Clear</button></form>`
              : ""
          }</td></tr>`,
        )
        .join("")}</table>`
    : "<p>No anonymous tester sessions.</p>";
  const appLink = crowd.slug ? `https://pind.social/crowd/${crowd.slug}` : null;
  return adminPage(
    request,
    ctx.email,
    "Testers",
    `<p>Real accounts on this list can see the <strong>seed</strong> gathering and its test people while signed in — nothing else, and nothing on any public page (V18's testers exception; P92–P99).</p>
<table><tr><th>Account</th><th>Added</th><th>By</th><th></th></tr>${rows || `<tr><td colspan="4">Nobody yet.</td></tr>`}</table>
<form method="post" action="/admin/testers"><input type="hidden" name="back" value="/admin/testers">
<label>Email of an existing account <input name="email" type="email" required></label> <button>Add tester</button></form>

<h2>The test crowd</h2>
<p>${crowd.slug ? `${crowd.people} test people pinned at the seed gathering. Open it in the app as a tester: <a href="${e(appLink)}">${e(appLink)}</a>` : "Not built yet."}</p>
<p>Eight people: five open to meeting (four with illustrated faces, one with a rejected photo), three pinned without — one with a face, two without — and a mix of tags and party sizes. Refreshing rebuilds them all.</p>
<h2>Walk it as a stranger</h2>
<p>Makes a <strong>fresh anonymous tester</strong> and hands it to this browser the way a quick pin does, then opens the test crowd — so A8 → pin → A27 <em>with the email code</em> → faces can be walked on the test crowd. It only ever makes anonymous testers. <strong>Use a private window</strong>: a browser already signed in to Pin'd keeps the session it has.</p>
<p><strong>At A27, use an address with no Pin'd account</strong> (for example a +walk address): an existing account is merged, and the pin moves to that account, which can only see the test crowd if it is a tester too.</p>
<form method="post" action="/admin/testers/anonymous-session"><button>Start an anonymous tester session in this browser</button></form>
${anonRows}

<h2>Rebuild</h2>
<form method="post" action="/admin/test-crowd"><input type="hidden" name="back" value="/admin/testers"><button>${crowd.slug ? "Refresh the test crowd" : "Build the test crowd"}</button></form>`,
  );
};

export const addTester: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const email = str(form, "email").toLowerCase();
  const { data } = await ctx.db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = data?.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) return back(form, { err: `No account with ${email}. They sign in once first.` }, "/admin/testers");
  const { error } = await ctx.db.rpc("admin_set_tester", { p_auth_user: user.id, p_on: true, p_actor: ctx.email, p_note: null });
  return back(form, error ? { err: error.message } : { ok: `${email} is a tester.` }, "/admin/testers");
};

export const removeTester: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const id = ctx.params.id ?? "";
  if (!UUID.test(id)) return back(form, { err: "Not an account id." }, "/admin/testers");
  const { error } = await ctx.db.rpc("admin_set_tester", { p_auth_user: id, p_on: false, p_actor: ctx.email, p_note: null });
  return back(form, error ? { err: error.message } : { ok: "Removed." }, "/admin/testers");
};

export const rebuildTestCrowd: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  try {
    const built = await buildTestCrowd(ctx.db, rasterise);
    return back(form, { ok: `${built.people} test people at /crowd/${built.slug}.` }, "/admin/testers");
  } catch (err) {
    return back(form, { err: err instanceof Error ? err.message : "The test crowd did not build." }, "/admin/testers");
  }
};

// A fresh anonymous user, made a tester, handed to this browser through the quick
// pin's own sealed cookie; the app claims it on its next load (M3.2). Only ever
// anonymous — admin_add_anonymous_tester refuses anything else (P123).
export const startAnonymousTester: AdminHandler = async (request, ctx) => {
  const crowd = await testCrowdStatus(ctx.db);
  if (!crowd.slug) return back(null, { err: "Build the test crowd first." }, "/admin/testers");
  const secret = ctx.env.SESSION_SECRET?.trim();
  const key = ctx.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!secret || !key) return back(null, { err: "SESSION_SECRET or SUPABASE_PUBLISHABLE_KEY is not set." }, "/admin/testers");
  const res = await fetch(`${projectUrl(ctx.env)}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ data: {} }),
  });
  const made = (await res.json().catch(() => ({}))) as { refresh_token?: string; user?: { id?: string } };
  if (!res.ok || !made.refresh_token || !made.user?.id) return back(null, { err: `Could not make an anonymous user (${res.status}).` }, "/admin/testers");
  const { error } = await ctx.db.rpc("admin_add_anonymous_tester", { p_user: made.user.id, p_actor: ctx.email });
  if (error) return back(null, { err: error.message }, "/admin/testers");
  const cookie = await seal(secret, { userId: made.user.id, refreshToken: made.refresh_token, issuedAt: Date.now() });
  return new Response(null, {
    status: 303,
    headers: { location: `/crowd/${crowd.slug}`, "set-cookie": pinCookie(cookie), "cache-control": "no-store" },
  });
};

export const clearAnonymousTester: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const id = ctx.params.id ?? "";
  if (!UUID.test(id)) return back(form, { err: "Not an account id." }, "/admin/testers");
  const { error } = await ctx.db.rpc("admin_clear_anonymous_tester", { p_user: id });
  return back(form, error ? { err: error.message } : { ok: "Cleared — that session no longer exists." }, "/admin/testers");
};
