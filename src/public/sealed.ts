// The quick pin's session, sealed in a cookie (M3.2 — what SESSION_SECRET was declared
// for in M1.0).
//
// The Worker signs a visitor in anonymously at A26 and must hand that session to the
// app without writing supabase-js's internal storage. So it keeps the session's
// refresh token in a cookie the page's JavaScript cannot read (HttpOnly), sealed with
// AES-GCM under a key derived from SESSION_SECRET: nobody can read it off a log line or
// forge one, and a changed byte fails to open. The app claims it once through
// `POST /session/claim` and installs it with supabase-js's own `setSession`.
//
// Pure WebCrypto, so it runs the same in the Worker and under `node --test` (Z01–Z04).

export const PIN_COOKIE = "pind_pin";
// Long enough to outlive the gathering it was made for; the anonymous user itself is
// deleted 30 days after its last gathering (decisions Part 3).
export const PIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 60;

export interface Sealed {
  userId: string;
  refreshToken: string;
  issuedAt: number;
}

const enc = new TextEncoder();

async function keyFrom(secret: string): Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>>> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`pind-pin-cookie:${secret.trim()}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function seal(secret: string, value: Sealed): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(secret), enc.encode(JSON.stringify(value))),
  );
  return `${b64url(iv)}.${b64url(body)}`;
}

// Null for anything that is not a cookie we sealed: missing, tampered, another key.
export async function unseal(secret: string, token: string | null | undefined): Promise<Sealed | null> {
  if (!token) return null;
  const [ivPart, bodyPart] = token.split(".");
  if (!ivPart || !bodyPart) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(ivPart) },
      await keyFrom(secret),
      fromB64url(bodyPart),
    );
    const value = JSON.parse(new TextDecoder().decode(plain)) as Sealed;
    return typeof value.userId === "string" && typeof value.refreshToken === "string" ? value : null;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// HttpOnly: no page script can read it. SameSite=Lax: sent on our own navigations and
// same-origin requests, not on another site's POST. Secure: HTTPS only.
export function pinCookie(value: string, maxAge = PIN_COOKIE_MAX_AGE): string {
  return `${PIN_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearPinCookie = () => `${PIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
