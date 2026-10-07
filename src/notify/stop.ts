// /account/stop — switch one kind of notification off, from the email itself (M3.3;
// Alex: "off in one tap").
//
// **A GET never changes anything.** Mail scanners open every link in an email to check
// it; a GET that switched notifications off would silence people who never tapped —
// a failure nobody would ever see. So:
//   * the mail client's own unsubscribe button (List-Unsubscribe, one-click, RFC 8058)
//     is a POST, and is the one-tap path;
//   * the link in the email opens this page, whose single button is the POST.
// Both are signed (stopToken): only a link we sent works, for that person and that kind.

import type { Env } from "../env";
import { escape, header, page } from "../public/layout";
import { serviceClient } from "../supabase";
import { KIND_NAME, stopTokenValid, type NotificationKind } from "./rules";

const done = (title: string, line: string, status = 200) =>
  page(`${header()}<h1>${escape(title)}</h1><p class="quiet">${escape(line)}</p><p><a href="/">See this week&#39;s crowds</a></p>`, {
    title: `${title} · Pin'd`,
    status,
    cache: "private, no-store",
  });

async function read(request: Request, env: Env) {
  const url = new URL(request.url);
  const p = url.searchParams.get("p") ?? "";
  const k = url.searchParams.get("k") ?? "";
  const t = url.searchParams.get("t") ?? "";
  const secret = env.SESSION_SECRET?.trim();
  const ok = !!secret && (await stopTokenValid(secret, p, k, t));
  return { p, k: k as NotificationKind, ok };
}

export async function stopPage(request: Request, env: Env): Promise<Response> {
  const { k, ok } = await read(request, env);
  if (!ok) return done("That link doesn't work", "It may have been copied incompletely. You can switch notifications off in Settings in the app.", 400);
  const action = new URL(request.url);
  return page(
    `${header()}<h1>Stop ${escape(KIND_NAME[k])}?</h1>
<p class="quiet">You'll stop getting these emails. You can switch them back on in Settings in the app.</p>
<form method="post" action="${escape(action.pathname + action.search)}"><button class="cta" type="submit">Stop these</button></form>`,
    { title: "Stop these · Pin'd", cache: "private, no-store" },
  );
}

export async function stopSubmit(request: Request, env: Env): Promise<Response> {
  const { p, k, ok } = await read(request, env);
  if (!ok) return done("That link doesn't work", "Nothing was changed.", 400);
  const { error } = await serviceClient(env).rpc("admin_switch_off", { p_person: p, p_kind: k });
  if (error) {
    console.error("stop notifications:", error.message);
    return done("That didn't go through", "Nothing was changed. Try again in a moment, or switch it off in Settings in the app.", 503);
  }
  return done("Done", `You won't get ${KIND_NAME[k]} emails any more. Switch them back on any time in Settings in the app.`);
}
