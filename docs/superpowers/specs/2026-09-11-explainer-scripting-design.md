# The explainer scripting layer

**Date:** 2026-09-11
**Status:** design, ready to build
**Follows:** `2026-09-11-explainer-commands-design.md` (the write path, and the `agent` actor it
records) and `2026-09-11-explainer-renders-design.md`.

## The problem

An explainer is authored by typing JSON into a textarea. Every other category in the studio has a
writing stage — a reel has a researched script and a planner, a handbook has a planner and a
reviser — and explainers have none. The document model is the hard part and it is done; what is
missing is the thing that fills it in.

## The four inputs

A brief is four fields, and no more:

| field | example | why it is here |
|---|---|---|
| `topic` | "database indexes" | what the explainer is about |
| `audience` | "backend engineers who have never read a query plan" | pitches the vocabulary |
| `claim` | "an index turns a scan into a lookup" | the one thing that must land; the payoff beat is built from it |
| `seconds` | 16 | the length to write to; the reference channel sits at 14-21s |

Four, because each one changes what is written. A fifth field nobody fills in is a field that makes
the form look like work.

## Three pieces, and the boundary between them

### `lib/explainer/fit.ts` — local, no model

The fit report is arithmetic over the folded document, not an opinion:

- **length** — `totalSeconds` against the brief's target
- **board** — rows on the board at each beat against the contract's row limit; a board that grows
  past what the renderer lays out well is the single most common way an explainer comes out bad
- **movement** — beats whose mutation list is empty; a beat that changes nothing is a still frame
- **shape** — one `hook` first, a `payoff` present, `cta` last if there is one
- **dead rows** — rows nothing ever mutates, which are decoration the viewer has to read anyway
- **text** — labels and notes near their limits, which the renderer will clip

Each note is `{ level: 'good' | 'warn' | 'bad', text }`. The report never blocks anything; it says
what a careful person would say reading the board.

### `lib/explainer/diff.ts` — local, no model

Two documents in, a list of plain-English change lines out: `+ row "edge"`, `b3: 2 changes -> 4`,
`theme midnight -> paper`. It exists so a model's proposal can be **approved rather than applied**:
the studio shows what would change and the user says yes. Diffing the folded boards would be more
precise and far less readable; this diffs the document, which is what the user edits.

### `lib/explainer/author.ts` — the model

```ts
export type Brief = { topic: string; audience: string; claim: string; seconds: number };
export async function draft(brief: Brief, deps?: AuthorDeps): Promise<ExplainerDoc>;
export async function revise(doc: ExplainerDoc, instruction: string, deps?: AuthorDeps): Promise<ExplainerDoc>;
```

`AuthorDeps` is `{ run?: Runner }` — the studio's own `thinker()` by default, a fake in tests. The
same shape `lib/ai/reel/plan.ts` uses, for the same reason: the switch in Settings picks the brain,
and nothing here gets an opinion about which.

**The prompt states the vocabulary and the shape**, both taken from the schema rather than restated
by hand where possible: the five mutation ops, the four roles, the row states, the icons, and the
rule that makes an explainer an explainer — *one scene that mutates, never a sequence of scenes*.
That rule is the finding the whole category was rebuilt around after measuring ten reels off the
reference channel, and it is the sentence the model most needs to be given.

**Validation is the fold.** Output goes through `extractJson`, `ExplainerDocSchema`, then `foldDoc`.
A document that cannot fold is not a document; on failure the model is asked once more with the
error quoted, which is what `lib/ai/repair.ts` does for handbooks. Twice failing is an error the
user sees, not a silent blank page.

**Nothing here writes.** `draft` and `revise` return a document. The route hands it to the page as a
proposal; approving it goes through `applyCommand(slug, { op: 'doc.replace', actor: 'agent' })`, so
an AI pass lands in the same history as everything else and can be undone one step at a time. This
is the payoff for recording the actor before anything wrote as one.

## The routes

| route | does |
|---|---|
| `POST /api/explainers/<slug>/author` | `{ mode: 'draft' \| 'revise', brief?, instruction? }` — think, then answer `{ doc, diff, fit }`. Writes nothing. |
| `POST /api/explainers` | gains an optional `brief`: create the explainer and draft into it in one step, because a blank two-row board is not a useful starting point for someone who came to write about indexes. |
| `GET /api/explainers/<slug>` | gains `fit`, computed from the document it already folded. |

A model call is slow — tens of seconds on the local provider. The author route is a plain request
that the page awaits with a spinner, not a job: unlike a render there is nothing to keep, nothing
to poll and nothing to lose if the tab closes, because the proposal is not saved until it is
approved.

## On screen

Under the board, a **Script** card:

- the four inputs, remembered in the document's `brief` field so a revise knows what was asked for
- **Draft** rewrites the whole document; **Revise** takes one instruction line
- while thinking, the card is busy and everything else stays usable
- the proposal appears as the diff, with **Approve** and **Discard**. Approve writes through the
  command layer as `agent`; the history panel shows one purple row that Undo reverses.

Beside it, the **Fit** card: the notes, worst first, with the length line always shown.

`brief` is stored on the document, which means the schema gains one optional object. It is the only
schema change in this spec, and it is what makes Revise able to say "shorter, and keep the claim"
without the user restating the brief every time.

## What this deliberately does not do

- **No research.** The reel category has a whole research stage with sources; an explainer is a
  board about something the author already knows. If that turns out to be wrong it is a fourth
  subsystem, not a flag on this one.
- **No streaming.** The proposal arrives whole. Watching JSON stream in is worse than a spinner,
  because a half-parsed document cannot be folded and so cannot be shown as a board.
- **No auto-approve.** Every model write is approved by a person. The actor exists to make an
  AI pass reversible, not to make it silent.

## Verification

| | |
| --- | --- |
| `fit` | a 40s document against a 16s brief reports the length as bad; an empty beat is reported; a row nothing touches is reported; a good document reports no warnings |
| `diff` | a theme change, an added row, a removed beat and a changed mutation count each produce one readable line; identical documents produce none |
| `draft` | a fake runner returning a good document yields it folded; returning prose yields the error; returning a document that will not fold retries once and succeeds on the second answer |
| `revise` | the instruction and the current document both reach the prompt |
| route | draft on a document that does not exist is a 404; a model that fails twice is a 502 with what it said |

Every test injects its runner. No test in this suite calls a model.
