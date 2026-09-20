// Wrangler serves *.ttf as Data modules (wrangler.jsonc "rules"), so an import gives
// the file's bytes. TypeScript needs telling.
declare module "*.ttf" {
  const bytes: ArrayBuffer;
  export default bytes;
}
