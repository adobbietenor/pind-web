// Escaping, on its own and importing nothing.
//
// The map and the OG card are pure renderers that the unit tests load directly in
// Node (tests/unit/public.test.ts), and Node cannot load @pind/shared, which is
// TypeScript meant for a bundler. Keeping this here is what lets those two modules
// be tested without a bundler in the way.
//
// Every later page prints names people typed, so nothing reaches markup without
// passing through here.
export function escape(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
