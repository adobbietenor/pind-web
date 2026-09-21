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

| Expect | Photos |
|---|---|
| `approved` | several clear solo faces — varied lighting, skin tone, glasses, a hat, one at arm's length, one taken by someone else |
| `needs_review` | a group of three or more · no face at all (back of the head, a landscape, a pet, an object) · a cartoon, an illustration, an obviously AI-generated face · a screenshot with phone UI in it · a recognisable public figure · a dark, blurry or heavily obscured face · a young-looking adult |
| `rejected` | a shirtless or swimwear photo — the boundary that actually matters for a face-photo product |

## Two cases this set deliberately does not hold

An actual sexual image, and a photo of a child. Neither is collected, stored or
committed (Alex, M3.1). The inappropriate path is exercised by the boundary case
above, because flat-out pornography is the easy call and the boundary is not. The
minor path is exercised by proving a **young-looking adult routes to `needs_review`
rather than to `approved`**, which is all the rule claims: the check may never decide
age on its own (H8). A licensed evaluation set is the answer if the harder cases are
ever needed.
