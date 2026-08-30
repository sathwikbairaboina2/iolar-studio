# iolar reels — editor: server-authoritative command layer

**Date:** 2026-08-30
**Status:** Approved design, pending implementation plan
**Location:** `C:\Users\sathwik\projects\comfyui-projects\iolar-reels`
**Branch:** `feat/reels-engine`

## 1. Purpose

Turn the reel studio into a real editor, built so that an agent can drive it end to end through
exactly the same operations a human does.

Today the studio can only select and seek. The 14 edit operations in `lib/reel/edits.ts` are reachable
only through inspector controls, they execute **in the browser**, and the page persists by `PUT`ing a
whole reel blob back. That client-side placement — not the UI — is what blocks agent control: an agent
can only overwrite an entire reel, with no named operations, no server-side validation, no shared
undo, and no way to observe what changed.

So the work is ordered by that constraint. The command layer comes first; the editor UI and the agent
surface are then two peers built on top of it, and the second one costs a thin adapter instead of a
refactor.

Scope is a **repair tool**: the agent generates the reel, the human fixes what is wrong. One video lane
and one caption lane, as today. No multi-track, no audio bed, no keyframes.

Principle carried from the engine spec: *the studio is autonomous first, editable second.* Editing
stays a minimal pass over an already-finished timeline.

New principle here: **every edit is a named command, and every client is equal.** The UI holds no edit
authority the agent lacks.

## 2. Architecture

Three layers. Only the middle one is new.

```
lib/reel/edits.ts          [EXISTS, UNCHANGED]  pure Reel -> Reel, 14 operations
        ^
lib/reel/commands.ts       [NEW]  named registry: zod arg schema + apply + summary
lib/reel/history.ts        [NEW]  snapshot store on disk, cursor, undo/redo
lib/reel/bus.ts            [NEW]  in-process pub/sub, one topic per slug
        ^
POST   /api/reel/[slug]/edit       {op, args, actor} -> {reel, entry}
GET    /api/reel/[slug]/history    -> {entries, cursor}
POST   /api/reel/[slug]/history    {action: undo|redo} -> {reel, cursor}
GET    /api/reel/[slug]/events     SSE, emits the reel on every change
        ^
studio UI  [client 1]              MCP server  [client 2, phase 3]
```

The edit core stays pure and untouched, so `reel.parity.test.ts` — which pixel-compares preview against
the ffmpeg export — keeps holding by construction. No new edit semantics are introduced anywhere in
this design.

### 2.1 Command registry

`lib/reel/commands.ts` maps an op name to a zod schema and the pure function it calls:

```ts
export const COMMANDS = {
  'clip.trim':       { args: z.object({ clipId: z.string(), edge: z.enum(['in','out']), deltaSec: z.number() }),
                       apply: (r, a) => edits.trimClip(r, a.clipId, a.edge, a.deltaSec),
                       summary: (a) => `trim ${a.clipId} ${a.edge} ${a.deltaSec > 0 ? '+' : ''}${a.deltaSec}s` },
  'clip.split':      { ... edits.splitClip ... },
  'clip.delete':     { ... }, 'clip.move': { ... }, 'clip.motion': { ... },
  'clip.fit':        { ... }, 'clip.transition': { ... }, 'clip.asset': { ... },
  'caption.edit':    { ... }, 'caption.nudge': { ... }, 'caption.toggle': { ... },
  'caption.merge':   { ... }, 'caption.split': { ... },
} as const;
```

The elided entries follow the same three-field shape; the sketch is shorthand, not an omission. One
entry per exported function in `edits.ts` (`reflow` is internal and gets no command), and a test asserts
that correspondence so the two files cannot drift.

`applyCommand(slug, {op, args, actor})` is the single write path:

1. reject unknown `op`
2. parse `args` with the op's zod schema
3. `loadReel(slug)`
4. resolve id arguments; reject if the clip or cue does not exist
5. apply the pure function
6. `validateReel` the result — a command may never persist an invalid reel
7. `saveReel(slug, next)`
8. `history.push(slug, next, {op, args, actor, summary})`
9. `bus.publish(slug, next)`

Steps 6-7 are the guarantee: nothing reaches disk unvalidated, and what is broadcast is what was saved.

The reel is saved *before* history is appended, deliberately. If the history write fails the command
still succeeds — the edit is applied and published, and the failure is logged. Losing one log entry is
strictly better than losing the user's edit. The reverse order cannot make that trade.

`actor` is a label supplied by the caller, not an authenticated identity. It exists so the history rail
can say who did what on a single-user local studio; it is not a permission boundary, and nothing in the
system behaves differently based on its value.

### 2.2 History

Snapshot-plus-label, as decided: whole reels on disk, each tagged with the op that produced it and the
actor that ran it.

```
data/reel/<slug>/history/
  index.json          # { cursor: number, entries: Entry[] }
  <seq>.json          # the whole reel as it stood after entry <seq>
```

```ts
type Entry = { seq: number; op: string; args: unknown; actor: 'ui' | 'agent'; at: string; summary: string };
```

- `seq` 0 is the reel as it stood before the first command, written lazily on first push.
- `cursor` points at the current entry. Undo restores `cursor - 1`, redo `cursor + 1`.
- A new command pushed while `cursor` is behind the tail **truncates the redo tail** first.
- Cap 50 entries; pruning drops the oldest entry and its snapshot file.
- Undo and redo are themselves not entries — they move the cursor. This keeps the log a record of
  intent rather than of navigation.

Reels are small JSON, so 50 snapshots is cheap and undo is trivially correct — no per-op inverse to
get wrong.

Asset generation writes to the reel out of band (`addAsset` / `updateAsset` while ComfyUI jobs land).
Those are **not** commands and do not enter history: they are not user intent and must never be undone.
`history.push` therefore always snapshots the reel it was handed, never a replay.

### 2.3 Live push

`lib/reel/bus.ts` is a module-level `Map<slug, Set<(reel: Reel) => void>>`. `GET /events` opens a
`text/event-stream`, subscribes, and writes each published reel as one SSE `data:` frame. A comment
heartbeat every 25s keeps intermediaries from closing an idle stream.

**Known limit, accepted:** this is in-process. It works because the studio runs as one local Next
process, and it breaks under multiple workers. Documented rather than solved; a Redis or file-watch
bus is the upgrade path if the studio ever runs multi-process.

On the client, `useReelStream(slug)` opens an `EventSource` and sets the reel from each frame. The
server's reel always wins — that is the point of server authority. `EventSource` reconnects on its own;
the hook refetches `GET /api/reel/[slug]` on reconnect to close any gap in what it missed.

Asset polling collapses into this: the existing 4s `shots` poll can be dropped once `addAsset` and
`updateAsset` publish to the bus too.

## 3. Editor UI

### 3.1 Timeline

`components/reel/Timeline.tsx` is rewritten around pointer events. Gestures map 1:1 onto commands:

| Gesture | Command |
|---|---|
| drag clip edge | `clip.trim` |
| drag clip body onto another slot | `clip.move` |
| `S` or Split button at playhead | `clip.split` |
| `Delete` on selection | `clip.delete` |
| drag caption bar | `caption.nudge` |
| double-click caption | `caption.edit` |
| inspector dropdowns | `clip.motion` / `clip.fit` / `clip.transition` |
| swap asset | `clip.asset` |

**One command per gesture, emitted on pointer-up.** During a drag the component renders a local preview
offset and sends nothing; releasing computes the delta and posts once. A drag that emitted per
pointermove would write 60 history entries a second, which is the obvious way to get this wrong.

Additions beyond today: a time ruler, a zoom control (pixels per second, so a 45s reel is workable), a
draggable playhead, and keyboard handling. Status tints and the clip/caption lane split stay as they
are.

### 3.2 History rail

`components/reel/HistoryRail.tsx` — a right-hand column, always visible, listing entries newest-first
with an actor badge (`YOU` / `AGENT`), the summary string, and undo/redo buttons. Always visible rather
than a drawer because seeing what the agent just did is the point when the agent is driving.

### 3.3 Page

`app/reel/[slug]/page.tsx` is 392 lines today and grows with every control added. The edit wiring moves
into `app/reel/[slug]/useReelEditor.ts`, a hook owning reel state, command dispatch, SSE subscription,
and undo/redo, exposing `{reel, run, undo, redo, history, connected}`. The page becomes layout: Player,
Timeline, Inspector, HistoryRail. The in-memory `undoRef` is deleted — history is server-backed now.

Optimistic application: `run()` applies the pure function locally for immediate feedback, then
reconciles with the reel the server returns. On error it reverts and surfaces the message.

## 4. Error handling

Errors are written for an agent reading them, not only for a human: each says what was wrong **and**
what valid input looks like.

| Condition | Status | Body |
|---|---|---|
| unknown `op` | 400 | `{error, validOps: [...]}` |
| args fail zod | 400 | `{error: <zod message>, schema: <op's shape>}` |
| clip/cue id not found | 404 | `{error, validIds: [...]}` |
| result fails `validateReel` | 409 | `{error}`, reel unchanged on disk |
| undo at start / redo at tail | 409 | `{error, cursor, length}` |
| reel missing | 404 | `{error}` |

A command that fails at any step persists nothing and publishes nothing. Save and publish happen only
after validation passes.

## 5. Testing

| File | Covers |
|---|---|
| `tests/reel.commands.test.ts` | every `edits.ts` export has a command; arg validation rejects bad input; apply produces a valid reel; unknown op and missing id are refused |
| `tests/reel.history.test.ts` | push/undo/redo round-trip; new command truncates the redo tail; 50-entry cap prunes oldest snapshot; out-of-band asset writes never enter history |
| `tests/api.reel.edit.test.ts` | endpoint contract — the status/body table in §4 |
| `tests/reel.bus.test.ts` | subscribe, publish, unsubscribe; no leak after close |
| `tests/reel.timeline.test.tsx` | drag gestures fire the right command with the right args; **one** command per drag, none during move |
| `tests/reel.parity.test.ts` | unchanged, must still pass — the proof the editor did not disturb export |

`reel.parity.test.ts` passing untouched is the acceptance criterion for the whole design.

## 6. Phases

1. **Command layer** — `commands.ts`, `history.ts`, `bus.ts`, the three routes, plus converting the
   page's existing inspector controls from `edits.foo(reel, …)` + `save(next)` into `run('clip.foo', …)`
   calls. The UI looks identical afterwards; only the write path moves. `PUT /api/reel/[slug]` stays for
   whole-reel writes (create, import) but the editor stops using it.
2. **Editor UI** — Timeline rewrite, HistoryRail, `useReelEditor` extraction.
3. **Agent surface** — an MCP server exposing the same commands plus read tools for reel state and
   history. Deferred; phase 1 is what makes it cheap, and it can wait indefinitely without penalty.

Phases 2 and 3 are independent once 1 lands.

## 7. Non-goals

Multi-track video, audio bed or mixing, keyframed motion, text and sticker layers, new transition
types, multi-user collaboration, cross-process SSE, editing anything outside a single reel.
