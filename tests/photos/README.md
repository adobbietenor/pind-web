# The labelled photo set

Alex supplies these. **The photos themselves are never committed** — `.gitignore`
keeps everything in this folder out of git except `labels.json` and this file, so a
run is reproducible without real people's faces being in the repository.

Run it from the repo root:

    node --env-file=.dev.vars scripts/photo-check-eval.ts            # dry
    node --env-file=.dev.vars scripts/photo-check-eval.ts --write    # records the spend

`labels.json` is a list of `{ "file", "expect", "note" }`, where `expect` is
`approved`, `rejected` or `needs_review`.

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
