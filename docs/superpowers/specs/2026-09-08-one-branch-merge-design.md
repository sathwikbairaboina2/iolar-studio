# One branch: consolidating handbooks, reels and the knowledge layer

**Date:** 2026-09-08
**Branch:** `feat/one-branch`, cut from `master` at `ea5603d`, in the worktree
`C:\Users\sathwik\projects\comfyui-projects\iolar-onebranch`.

## Goal

Every piece of work that exists anywhere in this repository — local branches, remote branches,
worktrees, stashes — ends up on one branch, with no change silently dropped. The branch is a
candidate for `master`; merging it is the user's decision, not part of this work.

## Inventory (verified 2026-09-08)

`master`, `feat/knowledge-layer` and the reels branches were compared with
`git merge-base --is-ancestor`, not by commit counts, so "already in master" means the content
is provably reachable from `master`.

| Branch | Head | State |
| --- | --- | --- |
| `master` | `ea5603d` | base of the new branch |
| `feat/knowledge-layer` | `ea5603d` | identical to master |
| `feat/reels-engine` | `d57009c` | ancestor of master |
| `feat/bite-audio-max` | `5b931f7` | ancestor of master |
| `feat/reel-build-boards` | `daecd1c` | ancestor of master |
| `feat/research-plugin-card` | `39e8a2d` | ancestor of master |
| `feat/short-video` | `13d9adc` | 1 commit outside master (docs only) |
| `feat/jobs-own-voice` | `38f625e` | 1 commit outside master |
| `feat/handbooks` | `f3fc5c4` | 17 commits outside master |

Nineteen commits exist outside `master` in the entire repository. No remote ref is ahead of its
local branch (`origin/master` is *behind*, at `d4f146c`). There are no stashes. All three
worktrees are clean apart from untracked scratch (`probe-icons.mjs`, `.claude/`) in the reels
worktree, which is not work to merge.

## Why this is a port, not a merge

`feat/handbooks` and `master` rewrote the same layout engine independently. `master` is 210
commits ahead of the branch and 17 behind it; `git merge` conflicts in roughly 47 files,
including every binary golden. A mechanical resolution would overwrite `master`'s newer engine
(absolute-placement packer, `reflowLayout`, covers, heroes, icons, the `thinker()` runner,
`spilledFrom` spillover, asset stamping) with the older one.

So the handbook work moves across as three kinds of change:

1. **Cherry-picks** — commits that touch files `master` did not rewrite.
2. **Additive subsystems** — whole files that do not exist on `master` at all, copied and then
   adapted to `master`'s APIs.
3. **Audited fixes** — behaviour changes inside files `master` rewrote. Each one is proved
   missing by a failing test before it is ported, and ported in `master`'s shape.

## Work in order

The order runs cheap-to-risky so the branch is green after every step.

### Stage 1 — Cherry-picks

- `13d9adc` (`feat/short-video`): the reels engine design spec, one new documentation file.
- `38f625e` (`feat/jobs-own-voice`): per-cut kokoro voice and speed — `lib/jobs/submit.ts`,
  `lib/reel/tts.ts`, `lib/settings.ts`, `tests/reel.tts.test.ts`.

`lib/reel/tts.ts` has moved under `master`'s 74 newer commits, so this cherry-pick may conflict;
resolve by hand in `master`'s shape and let `tests/reel.tts.test.ts` prove the behaviour.

### Stage 2 — Additive subsystems

These files have no counterpart on `master`. Each lands with its own tests and must compile and
pass before the next begins. The risk is call sites: they were written against the older schema,
store and renderer, and `master` renamed things (`thinker()`, `spilledFrom`, the knowledge
spaces module).

- **Network retry** — `lib/http.ts`, wired into `lib/ai/runner.ts` and the reference fetches.
  `master`'s runner retries nothing today, so a transient failure loses minutes of model work.
  Tests: `tests/http.test.ts`.
- **Verification and review** — `lib/verify/sandbox.ts`, `gates.ts`, `runGates.ts`, `review.ts`;
  the `parts/[part]/review` route; `components/editor/VerifyDrawer.tsx` with per-finding
  "Fix with AI"; publish gated on a passing review; per-part status in the chapter list.
  Tests: `tests/gates.test.ts`, `tests/sandbox.test.ts`, `tests/review.agent.test.ts`,
  `tests/verify.ui.test.tsx`.
- **Coverage repair** — `lib/ai/repair.ts`, the `[chapter]/coverage` route, and the coverage-gap
  panel in the Book drawer. Tests: `tests/repair.test.ts`.
- **Scripts** — the audit and end-to-end scripts under `scripts/` that these subsystems use.

### Stage 3 — Audited fixes

Every behaviour change inside a file `master` rewrote is handled the same way: write the failing
test on `feat/one-branch` first; if it passes unchanged, `master` already has the fix and the row
is closed as *already in master*. Known starting points:

- **`$`-sequence corruption** in `lib/renderer/page.ts`. `master` is still vulnerable: the page
  HTML is assembled with `String.replace('<!--CONTENT-->', content)`, so a `$&` or `$1` in page
  text is eaten by the replacement. Port the replacer-function fix.
- **Tail balancing** (`balanceTail`) is absent from `master`'s `lib/ai/fit.ts`; `master` has the
  polish loop instead. Port only if a real render shows a thin tail the polish loop leaves.
- **Spillover and store part-destruction fixes** (`0d09fc4`, `fdc7d4e`, `b81556a`). `master`
  rewrote both around `spilledFrom`; each fix gets its own test.
- **Heading-number stripping** in `lib/schema.ts`. `master` strips the `Page N:` prefix in
  `lib/renderer/page.ts`; drop the older fix if the test passes against `master`'s behaviour.
- **Points budget** in `lib/ai/book.ts`. `master` budgets in prose ("6-12 points per chapter");
  port the numeric budget only if a run overruns.
- Remaining rewritten files to audit: `lib/ai/fit.ts`, `lib/ai/plan.ts`, `lib/ai/spillover.ts`,
  `lib/renderer/blocks.ts`, `lib/renderer/capture.ts`, `lib/store.ts`, `lib/packageExport.ts`,
  `templates/_shared/{base.css,layout.js,pack.js}`, `templates/sticky-wall/template.html`,
  `vitest.config.ts`.

## The nothing-lost ledger

The guarantee that nothing is dropped is a written ledger, kept at
`docs/superpowers/plans/2026-09-08-one-branch-merge-ledger.md` and updated as the work runs.

It has two tables. **Commits:** all 19 commits outside `master`. **Files:** all 58 non-golden
files that differ between `master` and `feat/handbooks`.

Every row ends with exactly one verdict:

- `ported` — the change is on `feat/one-branch`, naming the commit that carries it.
- `already in master` — with the `master` file and line, or commit, that proves it.
- `superseded` — with the `master` mechanism that replaced it.
- `dropped` — only with the user's explicit agreement, recorded in the row.

The branch is not finished while any row is unclassified. The file table exists so that a fix
living in a file no stage planned to touch cannot slip through.

Golden PNGs are excluded from the file table on purpose: `feat/handbooks`' goldens were rendered
by the dead engine and are never copied. Any port that changes rendering re-approves `master`'s
own goldens instead.

## Testing and definition of done

- The full suite passes (`master` was at roughly 1056 passing tests).
- Every ported subsystem arrives with the tests from its source branch, adapted to `master`'s
  APIs, and those tests fail before the port and pass after it.
- Goldens are re-approved, never copied, and only where rendering genuinely changed.
- One real topic-mode handbook is generated and rendered end to end on the branch: zero overflow,
  no page under 85% fill, and the contact sheet judged by eye — a fill number alone does not
  close this, per the standing golden rule about using the space.
- The ledger has no unclassified rows.

## Out of scope

- Planner content quality. The shallow, ungrounded output of `bookFromTopic` and the per-page
  planner is a separate piece of work and is not touched here.
- The hand-drawn icon and connector look, built and rejected on 7 September.
- Deleting the branches that are already ancestors of `master`. They stay until the user says
  otherwise.
- Merging to `master` and pushing to `origin`. Both stay the user's decision after review.
