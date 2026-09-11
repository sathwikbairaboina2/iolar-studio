# The explainer editor

**Date:** 2026-09-11
**Status:** design, ready to build
**Follows:** the command layer (`2026-09-11-explainer-commands-design.md`), renders as jobs
(`2026-09-11-explainer-renders-design.md`) and the scripting layer
(`2026-09-11-explainer-scripting-design.md`). This is the fourth subsystem and it consumes all
three.

## The problem

Everything an explainer needs can be done, and all of it is done by editing JSON in a textarea.
The board preview is read-only, the beat list is a set of labels, and changing a row's value means
finding it in 120 lines of JSON and not breaking the brackets. The commands exist — seventeen of
them, each with a declared argument schema — and nothing on screen uses more than two.

## What this builds

Three things, each writing through the command layer that is already there, so undo keeps working
and nothing gains a second write path.

### 1. The beat rail

The beat list becomes a rail across the top of the board: one segment per beat, **width in
proportion to its length in seconds**, coloured by role. The rail is the only place a beat is
selected, and the board below always shows the board as it stands at the selected beat.

On the selected segment: its length, editable in place (`beat.sec`), its role (`beat.role`), and
the count of what it changes. Between segments, an insert control (`beat.add` with `after`).
Reordering is drag along the rail (`beat.move`) — the fold post-condition already refuses a move
that strips a dependency, and the refusal names the beat, so a bad drag is a message rather than a
broken document.

Proportional width is the point: a rail where a 6s payoff looks the same as a 2s step hides the
one thing a person actually tunes.

### 2. Click a node, edit a node

`ScenePreview` already draws the board. Every node becomes clickable, and a selected node opens an
inspector: label, value, unit, sub, state, tier, col, icon — the row fields, as a form.

Where the edit lands depends on where you are:

- **on the first beat** — the field belongs to the scene, so it writes `scene.row.set`
- **on any later beat** — the field is a change that beat makes, so it writes `mutation.add` with a
  `set` for that row, or updates the `set` that beat already has for it (`mutation.update`)

That rule is what makes the inspector honest. An explainer is one scene that mutates; editing "the
node" at beat four does not mean editing the scene, it means editing what beat four does to it.
The inspector says which of the two it is doing, in words, above the form.

### 3. The mutation list

Under the inspector, what the selected beat does, in order: one row per mutation, readable
(`set index → 2 ms, good`, `panel "x-cache: HIT"`, `link app → cache`). Remove and reorder are
`mutation.remove` and `mutation.move`. Adding a mutation the inspector cannot express — `text`,
`panel`, `link`, `add` — is a small form with the op chosen first.

The JSON textarea stays. It is the escape hatch, it goes through `doc.replace`, and it is
undoable. Nothing here replaces it; it stops being the only way.

## What this deliberately does not do

- **No canvas dragging.** Position is `tier` and `col`, which the renderer lays out. Dragging a
  node to a pixel would mean storing pixels, and the board would stop being able to lay itself out
  for a different theme or a different number of rows.
- **No inline text editing on the board.** The preview is an approximation of the render, not the
  render. Typing into an approximation invites trusting it.
- **No multi-select.** Every command takes one target. Selecting three rows to turn them all green
  is three commands, and the history is better for it.

## The shape of the code

| file | holds |
|---|---|
| `app/explainers/[slug]/BeatRail.tsx` | the rail, its selection, its inserts |
| `app/explainers/[slug]/RowInspector.tsx` | the row form, and the scene-or-mutation decision |
| `app/explainers/[slug]/MutationList.tsx` | what the beat does, in order |
| `lib/explainer/inspect.ts` | pure: given a document, a beat and a row id, what a field edit should write |
| `components/explainer/ScenePreview.tsx` | gains `selected` and `onSelect` |

`lib/explainer/inspect.ts` is the only part with logic worth testing on its own, and it is the part
that is easy to get wrong: it decides between `scene.row.set`, `mutation.add` and
`mutation.update`, and it has to find an existing `set` for that row in that beat before adding a
second one.

## Verification

| | |
| --- | --- |
| `inspect` | on beat one, a field edit writes `scene.row.set`; on a later beat it writes `mutation.add`; on a later beat that already sets that row it writes `mutation.update` with that index; a row added by a beat is editable at that beat |
| rail | widths sum to the document's length; the selected beat drives the board |
| commands | every control names a command that exists in `COMMANDS` |

The rail and the forms are UI over commands that are already tested. The test that matters is
`inspect`, because a wrong answer there writes a second `set` for the same row in the same beat —
which folds cleanly, renders cleanly, and is wrong.
