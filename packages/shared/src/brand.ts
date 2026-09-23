// The brand pieces' own proportions, so a header can lay them out without hard-coding
// two magic numbers in a second place (M3.1).
//
// The artwork itself lives in `src/public/brand.ts`, generated from `brand/*.svg` by
// `npm run brand`. That file imports nothing and is bundled by the Worker; this holds
// only the dimensions, which is all the app needs to size two PNGs correctly.
export const MARK = { width: 387.64, height: 387.64 } as const;
export const WORDMARK = { width: 141.52, height: 78.88 } as const;
