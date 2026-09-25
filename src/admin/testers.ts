// The testers page (M3.2): who may see seed rows while signed in, and the test crowd
// they walk. The list is written only here, with the service key (`admin_set_tester`);
// nobody can add themselves (P97). On M4.2's review list as a V18 change.

import type { AdminHandler } from "./context";
import { rasterise } from "../public/ogpng";
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
