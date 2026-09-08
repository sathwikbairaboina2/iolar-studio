# One branch — the nothing-lost ledger

Branch: `feat/one-branch`, cut from `master` at `ea5603d`. Spec:
`docs/superpowers/specs/2026-09-08-one-branch-merge-design.md`.

Every commit that existed outside `master` and every non-golden file that differed between
`master` and `feat/handbooks` has exactly one verdict below. Nothing is left unclassified.

## Commits (19)

| Commit | Branch | Verdict |
| --- | --- | --- |
| `13d9adc` docs: reels engine design spec | short-video | **superseded** — `master` carries a later revision of the same file (it records reels as filesystem-only; the branch's draft still said SQLite and the graph mirror them). Cherry-pick conflicted; resolved in favour of `master`. |
| `38f625e` per-cut kokoro voice and speed | jobs-own-voice | **already in master** — cherry-pick applied empty; `lib/reel/tts.ts` and `tests/reel.tts.test.ts` are byte-identical, and `jobsKokoroVoice` / `jobsKokoroSpeed` are in `lib/settings.ts:75`. |
| `d83ad58` content verification design spec | handbooks | **ported** — `5a63778`. |
| `19dd731` verification gates, sandbox, review agent | handbooks | **ported** — `7eb6680`. Adapted: this engine's code block has no `runnable` flag, so a snippet selects itself for execution by asserting a value in a trailing print comment. |
| `7721a49` Review drawer with per-finding Fix with AI | handbooks | **ported** — `7eb6680` (`VerifyDrawer`, wired beside `master`'s own page-ordering `ReviewPanel`, which is a different thing and stays). |
| `c8cd3d0` coverage is a chapter property, not a part property | handbooks | **ported** — `aac6982` (`repair.ts` merges every part before judging). |
| `8dba1b1` published status gated on review, per-part status | handbooks | **ported** — `7eb6680` (status + publish gate) and `4b19806` (per-part tags in the chapter list). |
| `1921835` chore: fix audit script typing | handbooks | **superseded** — it types the branch's own audit scripts, which are not on this branch (see the scripts row below). |
| `b81556a` keep worked examples whole; stop parts multiplying | handbooks | **split** — the layout half is **ported** (`8368c14`, consecutive code blocks merge into one unit); the spillover half is **superseded** by `master`'s `spilledFrom` parts. |
| `3c8d08f` retry transient network failures | handbooks | **ported** — `afcaa84`. |
| `90d3b3d` balance a starved final page | handbooks | **superseded** — `master` replaced tail balancing with the polish loop and its 80% last-page floor. |
| `3cf6f48` tail balancing crash when pagination outgrew the page count | handbooks | **superseded** — fixes `balanceTail`, which this engine does not have. |
| `0d09fc4` re-rendering a part destroyed the part after it | handbooks | **superseded** — `master` rewrote spillover around `spilledFrom`, which overwrites only the part a spill minted. |
| `fdc7d4e` creating a chapter over an existing one wiped its first part | handbooks | **ported** — `7eb6680` (`createChapter` refuses an existing slug). |
| `a8c6052` surface chapter coverage gaps in the Book drawer | handbooks | **ported** — `aac6982`. |
| `c005100` coverage repair pass | handbooks | **ported** — `aac6982`, rewired to the studio's provider switch instead of calling Claude directly. |
| `f43d234` coverage matcher flagged points the pages taught | handbooks | **ported** — `5a63778` (tokenised, stemmed, rarity-weighted matcher replaces the six-keyword one). |
| `c246c2e` stop eating `$` sequences; column-flow packer | handbooks | **split** — the `$` fix is **ported** (`1df3792`, `master` was still vulnerable); the packer is **superseded** by `master`'s absolute-placement packer. |
| `f3fc5c4` finish the chain a render starts; budget books by points | handbooks | **split** — the points budget is **ported** (`47019b0`); the render chain is **already in master** (its render route settles spillover and renders follow-ups). |

## Files (58 non-golden files that differed)

**Ported** — the change is on this branch:
`lib/http.ts`, `lib/verify/gates.ts`, `lib/verify/sandbox.ts`, `lib/verify/runGates.ts`,
`lib/verify/review.ts`, `lib/ai/repair.ts`, `lib/ai/book.ts`, `lib/ai/fit.ts`, `lib/store.ts`,
`lib/packageExport.ts`, `lib/renderer/page.ts`, `templates/_shared/layout.js`,
`app/api/handbooks/[subject]/[chapter]/coverage/route.ts`,
`app/api/handbooks/[subject]/[chapter]/parts/[part]/review/route.ts`,
`app/handbooks/[subject]/page.tsx`, `app/handbooks/[subject]/[chapter]/page.tsx`,
`components/editor/VerifyDrawer.tsx`, `components/editor/BookPanel.tsx`,
`components/editor/AiDrawer.tsx`, `components/editor/ReferencePanel.tsx`, `vitest.config.ts`,
`docs/superpowers/specs/2026-08-29-content-verification-design.md`, and the tests
`tests/http.test.ts`, `tests/gates.test.ts`, `tests/sandbox.test.ts`,
`tests/review.agent.test.ts`, `tests/verify.ui.test.tsx`, `tests/repair.test.ts`,
`tests/page.dollar.test.ts` (retargeted at this engine's inline-code markup).

**Superseded** — `master` rewrote the same file and its version is newer:
`lib/schema.ts` (more families, inks, frames, bullet styles and diagram kinds),
`lib/ai/plan.ts` (per-page planner, recipes), `lib/ai/spillover.ts` (`spilledFrom`),
`lib/renderer/blocks.ts`, `lib/renderer/capture.ts`,
`app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route.ts` (settles spillover, polish),
`templates/_shared/base.css`, `templates/_shared/pack.js`, `templates/sticky-wall/template.html`,
and the tests written against the old engine: `tests/blocks.test.ts`, `tests/fit.test.ts`,
`tests/pack.test.ts`, `tests/schema.test.ts`, `tests/spillover.test.ts` (asserts the old
follow-up policy: extend, cascade, never starve — this engine overwrites the part a spill
minted, by design), `tests/store.test.ts`, `tests/render.e2e.test.ts`,
`tests/fixtures/golden-post.json`.

**Superseded, one-off tooling** — analysis scripts written against the dead engine's APIs;
`master` carries its own (`fit-loop.mjs`, `approve-goldens.mjs`, `reindex.mts`,
`sample-render.mts`): `scripts/audit-coverage.mts`, `scripts/audit-gates.mts`,
`scripts/audit-verify.mts`, `scripts/coverage-audit.mts`, `scripts/debug-tail.mts`,
`scripts/e2e-bulk.mjs`, `scripts/e2e-chapters.mjs`, `scripts/e2e-subjects.mjs`,
`scripts/fit-loop.mjs`, `scripts/matcher-tune.mts`, `scripts/repair-coverage.mts`,
`scripts/rerender-thin.mjs`. Say the word if you want any of them rebuilt against this engine.

Golden PNGs are excluded on purpose: `feat/handbooks` rendered them with the dead engine.
`master`'s goldens still pass unchanged after every port above.

## Data (not in git — `/data/` is ignored)

The two worktrees held separate corpora: `iolar-studio` 23 subjects (old engine),
`iolar-reels` 16 subjects (this engine). Merged under your rule — master's copy wins, only
what master lacked came over:

- 10 subjects copied whole: `bash go graphql http kafka mongodb postgres redis rust terraform`.
- 10 chapters copied into subjects that already existed: `docker/compose`,
  `git/stash-worktrees`, `javascript/prototypes-this`, `kubernetes/configmaps-secrets`,
  `linux/text-processing`, `networking/subnetting-cidr`, `nodejs/module-resolution`,
  `python/context-managers`, `react/context-state`, `sql/indexes-explain`.
- Colliding chapter slugs were skipped, so no render made by this engine was overwritten.
- `scripts/reindex.mts` rebuilt the SQLite index over the merged corpus.
- The copied posts drew three diagram kinds this engine dropped, so 60 chapters failed
  validation. `scripts/migrate-legacy-diagrams.mts` (`b8c166d`) translated them in place —
  memory-cells to `array`, compare to `cards`, tree to `flowchart` or `chain` — rewriting 102
  posts (72 + 170 + 77 diagrams). All 205 posts on disk validate.

## State

Full suite green: 142 files, 1098 passed, 3 skipped. Typecheck and lint clean on every file
touched. Remaining: a real end-to-end render on this branch, judged by eye.
