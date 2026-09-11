# Explainer commands: one write path, and undo

**Date:** 2026-09-11
**Branch:** `feat/one-branch`, in the worktree
`C:\Users\sathwik\projects\comfyui-projects\iolar-reels`.

## Goal

Give the explainer category the write path the reel category already has: every edit a named
command with a declared argument schema, applied through one door by the studio and by an agent
alike, with undo behind it.

This is the first of four subsystems the Explainers tab needs. It is first because everything else
depends on it — an AI authoring pass and a form editor built against today's whole-document `PUT`
would both be rewritten the day commands land, and neither can offer undo or diff-approve until
the write path can name what changed.

## Where the category stands

The tab works end to end — author, fold, list, render — but against a `PUT` of the entire
document. Measured against the categories that have been through more cycles:

| | Reels | Handbooks | Explainers |
| --- | --- | --- | --- |
| Command layer | yes | — | no |
| Undo / redo | yes | — | no |
| AI authoring | agent | plan / revise / repair | none |
| Diff-approve | — | yes | no |
| Past jobs | yes | — | no |
| Editor | tabbed panels | drawers | a JSON textarea |

The four subsystems, in dependency order: **commands and history** (this spec), **render as a job
plus past renders**, **the scripting layer**, **the editor rework**. Two and three can run in
parallel once this exists; four consumes all three.

## What is being copied, and why

`lib/reel/commands.ts` states the principle this spec adopts: it is *the single write path into a
reel*, and every edit is a named command with a declared argument schema *so the studio and an
agent reach the same operations through the same door*. Two paths into the same document drift;
one cannot.

`lib/reel/history.ts` snapshots the whole document after each command rather than computing an
inverse, because *undo cannot be subtly wrong the way a hand-written inverse can*. Explainer
documents are a few KB of JSON. The cost is nothing.

Both are copied in shape, not adapted in spirit. Where this spec departs from reels it says so and
says why.

## The command layer

`lib/explainer/edits.ts` holds pure functions over a document. `lib/explainer/commands.ts` is the
registry that wraps them, with the same record shape reels uses:

```
{ fn, args: ZodTypeAny, refs?, apply(doc, args) -> doc, summary(args) -> string }
```

`applyOne(doc, { op, args, actor })` resolves the command, parses the arguments, checks the refs,
applies it, and returns the new document with a summary. It touches no disk and no bus, so the dry
run and the real write path cannot disagree about what would happen; persistence is the caller's
business.

`CommandError` carries an HTTP status and a machine-readable detail, including
`z.toJSONSchema(spec.args)` on a bad-argument rejection. An agent is a first-class caller here, so
a rejection has to say what was wrong **and** what valid input looks like.

### The commands

| Group | Command | Arguments |
| --- | --- | --- |
| document | `doc.theme` | `theme` |
| | `doc.replace` | `doc` — the whole document |
| scene | `scene.text` | `field` (title \| subtitle \| note), `to` |
| | `scene.row.add` | `row` |
| | `scene.row.set` | `rowId`, and any of `label`, `value`, `unit`, `sub`, `state`, `tier`, `col`, `icon` |
| | `scene.row.remove` | `rowId` |
| | `scene.link` | `from`, `to`, `state?`, `label?` |
| | `scene.panel.add` | `text`, `state?` |
| beats | `beat.add` | `role`, `after?` — the beat id to insert behind; omitted appends |
| | `beat.remove` | `beatId` |
| | `beat.move` | `beatId`, `toIndex` |
| | `beat.sec` | `beatId`, `sec` (null restores the role default) |
| | `beat.role` | `beatId`, `role` |
| | `mutation.add` | `beatId`, `mutation` |
| | `mutation.update` | `beatId`, `index`, `mutation` |
| | `mutation.remove` | `beatId`, `index` |
| | `mutation.move` | `beatId`, `from`, `to` |

`doc.replace` earns its place by removing a second write path rather than adding one: the JSON
escape hatch in the editor goes through a command too, so a paste-the-whole-thing edit lands in
history and is undoable like any other. Today's `PUT` becomes a thin wrapper over it.

### Row refs are beat-relative

This is the one place the design departs from reels, and the reason to build it carefully.

Reels resolve an id against a flat lane: a beat id is a beat id whenever you ask. An explainer's
rows are not flat. The board grows — a row added at `b3` does not exist at `b1` — so whether
`mutation.add { beatId: "b2", op: "set", row: "edge" }` is legal depends on **where that beat
sits**.

A ref on a row therefore folds the document up to the target beat and validates against the board
as it stands *there*, rejecting with the ids that exist at that point rather than the ids that
exist somewhere. Checking against the union of all rows would accept mutations the renderer
refuses; checking against the opening scene would reject ones that are correct.

### The fold is a post-condition

Every command folds its result before returning. A `FoldError` rejects the command, names the beat,
and writes nothing.

This is what makes it impossible to store a document that cannot render. `beat.move` is the case
that matters: moving a beat above the one that adds the row it sets is a legal-looking edit that
produces an unrenderable document, and it fails here, loudly, instead of at render time.

## History

`lib/explainer/history.ts`, mirroring reels: a `{ cursor, base, entries[] }` index beside
per-sequence snapshots of the whole document, under `data/explainer/<slug>/history/`. Each entry
records `op`, `args`, `actor` (`ui` | `agent`), `at`, and a human `summary`. The limit is 50.

`lib/paths.ts` gains `explainerHistoryDir`, `explainerHistoryIndex` and `explainerHistorySnap`
beside the paths it already has.

### A render is not history

An mp4 never enters the log, and undo never deletes one.

A render is a consequence, not user intent. Reels reasoned the same way about assets landing from
a provider: they never enter the log, so they can never be undone out from under a running job.
Undo moves the document back and leaves `renders/` alone; the list shows the mp4 as older than the
document it came from, which is true and useful.

## Routes

| Route | |
| --- | --- |
| `POST /api/explainers/[slug]/edit` | `{ op, args, actor }` → `{ doc, entry, steps }` |
| `GET /api/explainers/[slug]/history` | the log |
| `POST /api/explainers/[slug]/history` | `{ move: 'undo' \| 'redo' }` → `{ doc, log, steps }` |
| `PUT /api/explainers/[slug]` | a thin wrapper over `doc.replace` |
| `GET /api/explainers/[slug]` | unchanged |

`actor` defaults to `'agent'`, copying the reel route: the studio always labels itself, so anything
that did not bother to say is, by elimination, not the studio.

Every command response carries `steps` — the folded board, one entry per beat. The fold has already
happened as a post-condition, so returning it costs nothing and saves the editor a round trip on
every edit. That is the difference between a board that feels live and one that flickers.

## What changes on screen

Small, deliberately. The editor rework is a later subsystem.

- **Undo and redo** in the editor header, wired to `POST /history`. The reason commands come first
  is that these become possible at all.
- **A history panel**: the log as a list of summaries, each tagged `ui` or `agent` with a time.
  When the scripting layer lands, an AI pass appears as a run of `agent` entries that can be
  stepped back through one at a time. That is the payoff for recording the actor now, before
  anything writes as an agent.
- **`useExplainerEditor`**, mirroring `useReelEditor`: `refresh`, `run(op, args)`,
  `move('undo' | 'redo')`, with `busy` and an `alive` guard. The board redraws from the `steps` each
  command returns.

The JSON textarea is unchanged and silently becomes undoable.

## Verification

Everything here is offline: no templates service, no renders.

| | |
| --- | --- |
| `applyOne` | one happy path and one rejection per command |
| Beat-relative refs | a mutation naming a row that exists at `b4` but not at `b2` is rejected at `b2`, listing the ids that do exist there |
| Fold post-condition | a `beat.move` that strips a dependency is refused with the beat named, and the document on disk is unchanged |
| Registry ↔ edits | a test pinning the correspondence, as reels does |
| History | apply → undo → redo round-trips the document. Past 50 entries the log stays self-consistent: the base still names a snapshot that exists on disk, and undoing all the way to cursor 0 still restores it |
| Route | an unknown op returns `validOps`; a bad argument returns the schema |

`applyOne` touching no disk is what keeps most of this trivial.

The beat-relative ref test is the one to write first. It is the only place this design departs from
reels, and getting it wrong lets the editor write documents the renderer refuses — which is the
class of bug the fold post-condition exists to prevent.

## Out of scope

- **The scripting layer.** The four inputs, `revise`, diff-approve and the fit report are the third
  subsystem. This spec only makes them possible by giving them commands to write through and an
  actor to write as.
- **Render as a job.** `POST /render` still blocks for the length of the render. That is a real
  flaw and it is the second subsystem, independent of this one.
- **The editor rework.** Beat rail, click-to-select nodes, a form inspector and a timeline are the
  fourth subsystem, and they consume all three before them.
- **Multi-command transactions.** Commands apply one at a time. Reels does the same, and nothing in
  the explainer flow yet needs two edits to land or fail together.
