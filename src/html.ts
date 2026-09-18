// Plain HTML via template strings. System fonts, one purple button, no framework.

const CSS = `
body{margin:0;padding:24px 16px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;background:#fff}
main{max-width:560px;margin:0 auto}
h1{font-size:1.5rem;line-height:1.2;margin:0 0 16px}
a{color:#582883}
.button{display:inline-block;padding:12px 20px;border:0;border-radius:8px;background:#582883;color:#fff;font:inherit;text-decoration:none;cursor:pointer}
.error{color:#b00020}
`;

// Escape any value before it goes into HTML. Every later page prints names
// people typed, so nothing reaches markup without passing through here.
export function escape(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// `body` is trusted markup built by our own handlers; escape user values first.
export function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>${CSS}</style>
</head>
<body><main>${body}</main></body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
