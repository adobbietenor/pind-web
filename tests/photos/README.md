# The labelled photo set

Alex supplies these. **The photos themselves are never committed** — `.gitignore`
keeps everything in this folder out of git except `labels.json` and this file, so a
run is reproducible without real people's faces being in the repository.

Run it from the repo root:

    node --env-file=.dev.vars scripts/photo-check-eval.ts            # dry
    node --env-file=.dev.vars scripts/photo-check-eval.ts --write    # records the spend

`labels.json` is a list of `{ "file", "expect", "note" }`, where `expect` is
`approved`, `rejected` or `needs_review`.

## Known-good, before your photos arrive

Exercised end to end on 21 Sept 2026 with two stand-ins (the app icon and the
favicon, both labelled `needs_review` because neither is a face), `--write` on:

- both runs agreed with the label, 2 of 2;
- **runs 1 and 2 disagreed on 0 of 2** — the noise floor, measured rather than assumed;
- **$0.0033 a photo**, and all four calls landed in `photo_checks` with
  `source = 'eval'` and no person, so the spend is inside the daily cap;
- the model's reasons were specific ("No face visible at all — just a solid purple
  image"), not boilerplate.

So the runner, the table, the noise-floor line and the spend recording are all proven.
What has not been tested is the rubric against **faces**, which is what this set is for.

## What the set needs

**The rubric changed on 21 Sept 2026** (Alex, after the first real photo through it was
held). The bar is now harm, not quality — so most of what this set used to test as
`needs_review` is `approved`, and the set exists mainly to catch the check **drifting
back** to holding ordinary photos.

| Expect | Photos |
|---|---|
| `approved` | clear solo faces · **a group or wedding photo with a clear main subject** · a crowd · no face at all (a landscape, a pet, the back of a head) · a cartoon, an avatar, an AI-generated face · a screenshot · a recognisable public figure · a dark or blurry face · **a shirtless or swimwear photo** |
| `needs_review` | a young-looking adult — the only reason a photo is ever held |
| `rejected` | nothing in this set: the three refusals are nudity, hate symbols and gore, and none of them belong in a repository |

**The swimwear case moved from `rejected` to `approved`** in the same change. It is not
nudity, and treating it as such is what made the check hold ordinary photos.

## Two cases this set deliberately does not hold

An actual sexual image, and a photo of a child. Neither is collected, stored or
committed (Alex, M3.1). **The rejected path is therefore not tested by this set at
all** — that is a deliberate gap, not an oversight, and it is the one thing here that
a licensed evaluation set would be for.

The minor path is exercised by proving a **young-looking adult routes to
`needs_review` rather than to `approved`**, which is all the rule claims: the check
may never decide age on its own (H8).
