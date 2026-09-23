# Sign-in marks — official files only (A1, M3.1)

Nothing here is drawn or typed. The first web Apple button carried an Apple logo
typed from memory, the same failure as the Canadian flag; these replaced it.

| File | Source | Changed |
|---|---|---|
| `apple-logo-white-medium.svg` | Apple Design Resources, `Logo-Sign-in-with-Apple.dmg` → `Logo - SIWA - Left-aligned - White - Medium.svg` | renamed only; byte-identical |
| `google-g.source.svg` | Google, `developers.google.com/static/identity/images/signin-assets.zip` → `Android + Web/SVG/Dark/Theme=Dark, Show text=No, Shape=Square, Platform=Android+Web.svg` | the two button-background paths removed and the viewBox set to the G's own 20×20 box; the G, its mask and gradient untouched |
| `google-g.png` | `google-g.source.svg` rendered at 8× by headless Chrome on a transparent background | checked against Google's own `@4x` PNG of the same button: mean difference under 1/255 per channel |

**Why the G is a PNG.** Google's SVG draws its gradient with a `foreignObject`, which
an SVG used as an image does not render reliably on iOS Safari, and React Native
cannot draw it at all.

**Apple's rules for these files** (HIG, "Creating a custom Sign in with Apple
button"): match the logo file's height to the button's, never crop it, never add
vertical padding, and keep logo and title both black or both white.

Downloaded 22 Sept 2026.
