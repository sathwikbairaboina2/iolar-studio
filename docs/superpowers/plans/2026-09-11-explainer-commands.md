# Explainer Command Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the explainer category one write path — every edit a named command with a declared
argument schema — with snapshot undo behind it.

**Architecture:** Mirrors `lib/reel/commands.ts` and `lib/reel/history.ts` in shape. `edits.ts`
holds pure functions over a document; `commands.ts` is a registry wrapping them with zod argument
schemas; `applyOne` touches no disk so the dry run and the real write cannot disagree;
`applyCommand` persists and logs. Two departures from reels, both deliberate: row refs resolve
against the board **as it stands at the target beat**, and every command folds its result as a
post-condition.

**Tech Stack:** TypeScript, Next.js (App Router), zod v4, vitest, antd.

**Spec:** `docs/superpowers/specs/2026-09-11-explainer-commands-design.md` — read both.

**Repository:** `C:\Users\sathwik\projects\comfyui-projects\iolar-reels`, branch `feat/one-branch`.

## Global Constraints

- Mirror the reel pattern in shape. When in doubt, open `lib/reel/commands.ts` or
  `lib/reel/history.ts` and copy the structure rather than inventing one.
- `applyOne` must touch no disk and no bus. Persistence is the caller's business.
- `CommandError` carries an HTTP status and a machine-readable detail. On a bad-argument
  rejection the detail includes `z.toJSONSchema(spec.args)` — an agent is a first-class caller and
  a rejection must say what valid input looks like.
- `actor` is `'ui' | 'agent'` and defaults to `'agent'`: the studio always labels itself.
- `HISTORY_LIMIT = 50`.
- A render never enters the log. Undo must never delete an mp4.
- Every command folds its result before returning. A `FoldError` rejects with the beat named and
  writes nothing.
- Test command: `npx vitest run tests/<file>` from the repo root. Typecheck: `npx tsc --noEmit`.
  Lint: `npx eslint <paths>`.
- Do not edit `lib/reel/**` or `tests/reel.*`. This work adds a category; it does not change one.

---

### Task 1: History paths and the log

The snapshot log, copied from reels. It has no opinion about commands, so it can be built and
tested first.

**Files:**
- Modify: `lib/paths.ts` (append)
- Create: `lib/explainer/history.ts`
- Test: `tests/explainer.history.test.ts`

**Interfaces:**
- Consumes: `ExplainerDoc` from `lib/explainer/schema`; `get`/`save` from `lib/explainer/store`.
- Produces: `HISTORY_LIMIT`, `Actor`, `Entry`, `Log`, `read(slug)`, `push(slug, previous, next, meta)`,
  `undo(slug)`, `redo(slug)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/explainer.history.test.ts
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'explainer-history-'));
  process.env.IOLAR_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.IOLAR_DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

const doc = (title: string) => ({
  template: 'explainer' as const,
  theme: 'midnight',
  ratio: '9:16' as const,
  fps: 30 as const,
  brand: { handle: '@stackframe', name: 'Stack Frame' },
  scene: { title, subtitle: null, rows: [], links: [], note: null, panel: [] },
  beats: [
    { id: 'b1', role: 'hook' as const, sec: null, mutations: [] },
    { id: 'b2', role: 'payoff' as const, sec: null, mutations: [] },
  ],
});

const meta = (op: string) => ({ op, args: {}, actor: 'ui' as const, summary: op });

describe('explainer history', () => {
  it('records an entry and can undo back to the previous document', async () => {
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', doc('first'));

    await history.push('x', doc('first'), doc('second'), meta('scene.text'));
    await store.save('x', doc('second'));

    const back = await history.undo('x');
    expect(back.doc.scene.title).toBe('first');
    expect((await store.get('x'))!.scene.title).toBe('first');
  });

  it('redoes what it undid', async () => {
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', doc('first'));
    await history.push('x', doc('first'), doc('second'), meta('scene.text'));
    await history.undo('x');

    const forward = await history.redo('x');
    expect(forward.doc.scene.title).toBe('second');
  });

  it('refuses to undo past the beginning', async () => {
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', doc('only'));
    await expect(history.undo('x')).rejects.toThrow(/nothing to undo/);
  });

  it('abandons the redo tail when a command follows an undo', async () => {
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', doc('a'));
    await history.push('x', doc('a'), doc('b'), meta('one'));
    await history.undo('x');
    const log = await history.push('x', doc('a'), doc('c'), meta('two'));
    expect(log.entries.map((e) => e.op)).toEqual(['two']);
    expect(log.cursor).toBe(1);
  });

  it('keeps the log self-consistent past the limit', async () => {
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', doc('0'));
    for (let i = 1; i <= history.HISTORY_LIMIT + 5; i += 1) {
      await history.push('x', doc(String(i - 1)), doc(String(i)), meta(`edit-${i}`));
    }
    const log = await history.read('x');
    expect(log.entries).toHaveLength(history.HISTORY_LIMIT);

    // The base still names a snapshot that exists: undoing all the way back must work.
    for (let i = 0; i < history.HISTORY_LIMIT; i += 1) await history.undo('x');
    const floor = await store.get('x');
    expect(floor).not.toBeNull();
    await expect(history.undo('x')).rejects.toThrow(/nothing to undo/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explainer.history.test.ts`
Expected: FAIL — cannot resolve `@/lib/explainer/history`.

- [ ] **Step 3: Append the paths**

Add to the end of `lib/paths.ts`:

```ts
/** Undo for an explainer: an index beside one snapshot of the whole document per sequence. */
export function explainerHistoryDir(slug: string) { return path.join(explainerDir(slug), 'history'); }
export function explainerHistoryIndex(slug: string) { return path.join(explainerHistoryDir(slug), 'index.json'); }
export function explainerHistorySnap(slug: string, seq: number) { return path.join(explainerHistoryDir(slug), `${seq}.json`); }
```

- [ ] **Step 4: Write the log**

```ts
// lib/explainer/history.ts
import { promises as fs } from 'fs';
import { explainerHistoryDir, explainerHistoryIndex, explainerHistorySnap } from '@/lib/paths';
import { ExplainerDocSchema, type ExplainerDoc } from './schema';
import { save } from './store';

/**
 * Undo for the studio, shared by every client that edits an explainer.
 *
 * The whole document is snapshotted after each command rather than an inverse being computed for
 * it. Explainer documents are a few KB of JSON, so the cost is nothing and undo cannot be subtly
 * wrong the way a hand-written inverse can.
 *
 * Note what is NOT here: a render. An mp4 is a consequence rather than user intent, so it never
 * enters the log and undo never deletes one.
 */

export const HISTORY_LIMIT = 50;

export type Actor = 'ui' | 'agent';

export type Entry = {
  seq: number;
  op: string;
  args: unknown;
  actor: Actor;
  at: string;
  summary: string;
};

export type Log = { cursor: number; entries: Entry[] };

/** On disk the log also tracks which snapshot cursor 0 refers to. */
type StoredLog = Log & { base: number };

const EMPTY: StoredLog = { cursor: 0, base: 0, entries: [] };

async function readStored(slug: string): Promise<StoredLog> {
  try {
    return JSON.parse(await fs.readFile(explainerHistoryIndex(slug), 'utf8')) as StoredLog;
  } catch {
    return { ...EMPTY, entries: [] };
  }
}

async function writeStored(slug: string, log: StoredLog): Promise<void> {
  await fs.mkdir(explainerHistoryDir(slug), { recursive: true });
  await fs.writeFile(explainerHistoryIndex(slug), JSON.stringify(log, null, 2));
}

async function writeSnap(slug: string, seq: number, doc: ExplainerDoc): Promise<void> {
  await fs.mkdir(explainerHistoryDir(slug), { recursive: true });
  await fs.writeFile(explainerHistorySnap(slug, seq), JSON.stringify(doc, null, 2));
}

async function readSnap(slug: string, seq: number): Promise<ExplainerDoc> {
  return ExplainerDocSchema.parse(JSON.parse(await fs.readFile(explainerHistorySnap(slug, seq), 'utf8')));
}

async function dropSnap(slug: string, seq: number): Promise<void> {
  await fs.rm(explainerHistorySnap(slug, seq), { force: true });
}

/** Which snapshot holds the document as it stands at a given cursor position. */
function seqAt(log: StoredLog, cursor: number): number {
  return cursor === 0 ? log.base : log.entries[cursor - 1].seq;
}

function nextSeq(log: StoredLog): number {
  return log.entries.length ? log.entries[log.entries.length - 1].seq + 1 : log.base + 1;
}

/** The log without the storage detail callers have no use for. */
function project(log: StoredLog): Log {
  return { cursor: log.cursor, entries: log.entries.map(({ ...e }) => e) };
}

export async function read(slug: string): Promise<Log> {
  return project(await readStored(slug));
}

export async function push(
  slug: string,
  previous: ExplainerDoc,
  next: ExplainerDoc,
  meta: { op: string; args: unknown; actor: Actor; summary: string }
): Promise<Log> {
  const log = await readStored(slug);

  if (!log.entries.length && log.cursor === 0) await writeSnap(slug, log.base, previous);

  // A command issued after an undo abandons the redo tail; its snapshots go too.
  if (log.cursor < log.entries.length) {
    for (const dead of log.entries.slice(log.cursor)) await dropSnap(slug, dead.seq);
    log.entries = log.entries.slice(0, log.cursor);
  }

  const seq = nextSeq(log);
  await writeSnap(slug, seq, next);
  log.entries.push({ seq, at: new Date().toISOString(), ...meta });
  log.cursor = log.entries.length;

  while (log.entries.length > HISTORY_LIMIT) {
    const [oldest] = log.entries.splice(0, 1);
    // The dropped entry's own snapshot becomes the new floor, so cursor 0 stays valid.
    await dropSnap(slug, log.base);
    log.base = oldest.seq;
    log.cursor -= 1;
  }

  await writeStored(slug, log);
  return project(log);
}

async function moveTo(slug: string, log: StoredLog, cursor: number): Promise<{ doc: ExplainerDoc; cursor: number }> {
  const doc = await readSnap(slug, seqAt(log, cursor));
  await save(slug, doc);
  log.cursor = cursor;
  await writeStored(slug, log);
  return { doc, cursor };
}

export async function undo(slug: string): Promise<{ doc: ExplainerDoc; cursor: number }> {
  const log = await readStored(slug);
  if (log.cursor <= 0) throw new Error('nothing to undo');
  return moveTo(slug, log, log.cursor - 1);
}

export async function redo(slug: string): Promise<{ doc: ExplainerDoc; cursor: number }> {
  const log = await readStored(slug);
  if (log.cursor >= log.entries.length) throw new Error('nothing to redo');
  return moveTo(slug, log, log.cursor + 1);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/explainer.history.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/paths.ts lib/explainer/history.ts tests/explainer.history.test.ts
git commit -m "feat(explainer): snapshot history

The whole document after each command rather than an inverse, because
explainer documents are a few KB and undo cannot then be subtly wrong.
A render never enters the log: it is a consequence, not intent."
```

---
### Task 2: The pure edits

Seventeen functions over a document. No validation, no disk, no zod — the registry above them owns
argument parsing and the fold. Each returns a new document; none mutates its input.

**Files:**
- Create: `lib/explainer/edits.ts`
- Test: `tests/explainer.edits.test.ts`

**Interfaces:**
- Consumes: `ExplainerDoc`, `Row`, `Link`, `Mutation`, `Role`, `RowState` from `./schema`.
- Produces: `setTheme`, `replaceDoc`, `setSceneText`, `addSceneRow`, `setSceneRow`,
  `removeSceneRow`, `setSceneLink`, `addScenePanel`, `addBeat`, `removeBeat`, `moveBeat`,
  `setBeatSec`, `setBeatRole`, `addMutation`, `updateMutation`, `removeMutation`, `moveMutation`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/explainer.edits.test.ts
import { describe, expect, it } from 'vitest';
import * as edits from '@/lib/explainer/edits';
import { ExplainerDocSchema, type ExplainerDoc } from '@/lib/explainer/schema';

const doc = (): ExplainerDoc => ExplainerDocSchema.parse({
  template: 'explainer',
  theme: 'midnight',
  brand: { handle: '@stackframe', name: 'Stack Frame' },
  scene: {
    title: 'Caching',
    rows: [{ id: 'app', label: 'App' }, { id: 'db', label: 'Database', value: 200, unit: ' ms' }],
    links: [{ from: 'app', to: 'db' }],
    panel: [{ text: 'GET /user' }],
  },
  beats: [
    { id: 'b1', role: 'hook', mutations: [] },
    { id: 'b2', role: 'payoff', mutations: [{ op: 'set', row: 'db', value: 2 }] },
  ],
});

describe('document edits', () => {
  it('sets the theme without touching anything else', () => {
    const next = edits.setTheme(doc(), 'paper');
    expect(next.theme).toBe('paper');
    expect(next.scene).toEqual(doc().scene);
  });

  it('never mutates its input', () => {
    const before = doc();
    edits.setSceneText(before, 'title', 'Changed');
    expect(before.scene.title).toBe('Caching');
  });
});

describe('scene edits', () => {
  it('adds, changes and removes a row', () => {
    let d = edits.addSceneRow(doc(), { id: 'edge', label: 'Edge', value: null, unit: '', sub: null, state: 'idle', tier: 1, col: 0, icon: 'cache' });
    expect(d.scene.rows.map((r) => r.id)).toEqual(['app', 'db', 'edge']);

    d = edits.setSceneRow(d, 'edge', { value: 10, state: 'good' });
    expect(d.scene.rows[2]).toMatchObject({ value: 10, state: 'good', label: 'Edge' });

    d = edits.removeSceneRow(d, 'edge');
    expect(d.scene.rows.map((r) => r.id)).toEqual(['app', 'db']);
  });

  it('a repeated link edits the one already drawn', () => {
    const d = edits.setSceneLink(doc(), 'app', 'db', 'good', undefined);
    expect(d.scene.links).toHaveLength(1);
    expect(d.scene.links[0].state).toBe('good');
  });

  it('appends a panel line', () => {
    const d = edits.addScenePanel(doc(), 'x-cache: HIT', 'good');
    expect(d.scene.panel.map((p) => p.text)).toEqual(['GET /user', 'x-cache: HIT']);
  });
});

describe('beat edits', () => {
  it('appends a beat when no anchor is given', () => {
    const d = edits.addBeat(doc(), 'step', undefined);
    expect(d.beats.map((b) => b.role)).toEqual(['hook', 'payoff', 'step']);
  });

  it('inserts a beat behind the anchor', () => {
    const d = edits.addBeat(doc(), 'step', 'b1');
    expect(d.beats.map((b) => b.role)).toEqual(['hook', 'step', 'payoff']);
  });

  it('gives a new beat an id nothing else is using', () => {
    const d = edits.addBeat(edits.addBeat(doc(), 'step', undefined), 'step', undefined);
    expect(new Set(d.beats.map((b) => b.id)).size).toBe(d.beats.length);
  });

  it('moves, retimes and reroles a beat', () => {
    let d = edits.moveBeat(doc(), 'b2', 0);
    expect(d.beats.map((b) => b.id)).toEqual(['b2', 'b1']);
    d = edits.setBeatSec(d, 'b1', 5.5);
    expect(d.beats.find((b) => b.id === 'b1')!.sec).toBe(5.5);
    d = edits.setBeatSec(d, 'b1', null);
    expect(d.beats.find((b) => b.id === 'b1')!.sec).toBeNull();
    d = edits.setBeatRole(d, 'b1', 'step');
    expect(d.beats.find((b) => b.id === 'b1')!.role).toBe('step');
  });

  it('removes a beat', () => {
    const d = edits.removeBeat(doc(), 'b1');
    expect(d.beats.map((b) => b.id)).toEqual(['b2']);
  });
});

describe('mutation edits', () => {
  it('adds, updates, moves and removes a mutation', () => {
    let d = edits.addMutation(doc(), 'b2', { op: 'text', field: 'note', to: 'done' });
    expect(d.beats[1].mutations).toHaveLength(2);

    d = edits.updateMutation(d, 'b2', 0, { op: 'set', row: 'db', value: 5 });
    expect(d.beats[1].mutations[0]).toMatchObject({ op: 'set', value: 5 });

    d = edits.moveMutation(d, 'b2', 0, 1);
    expect(d.beats[1].mutations[0].op).toBe('text');

    d = edits.removeMutation(d, 'b2', 0);
    expect(d.beats[1].mutations.map((m) => m.op)).toEqual(['set']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explainer.edits.test.ts`
Expected: FAIL — cannot resolve `@/lib/explainer/edits`.

- [ ] **Step 3: Write the edits**

```ts
// lib/explainer/edits.ts
import type { ExplainerDoc, Link, Mutation, Role, Row, RowState } from './schema';

/**
 * Pure functions over a document. Every one returns a new document and none mutates its input.
 *
 * There is no validation here on purpose: `commands.ts` owns argument parsing, the reference
 * checks and the fold. Keeping this layer dumb is what lets it be read at a glance.
 */

const clone = (doc: ExplainerDoc): ExplainerDoc => ({
  ...doc,
  scene: {
    ...doc.scene,
    rows: doc.scene.rows.map((r) => ({ ...r })),
    links: doc.scene.links.map((l) => ({ ...l })),
    panel: doc.scene.panel.map((p) => ({ ...p })),
  },
  beats: doc.beats.map((b) => ({ ...b, mutations: b.mutations.map((m) => ({ ...m })) as Mutation[] })),
});

export function setTheme(doc: ExplainerDoc, theme: string): ExplainerDoc {
  return { ...clone(doc), theme };
}

/** The JSON escape hatch. It is a command so that even a wholesale paste is undoable. */
export function replaceDoc(_doc: ExplainerDoc, next: ExplainerDoc): ExplainerDoc {
  return clone(next);
}

export function setSceneText(doc: ExplainerDoc, field: 'title' | 'subtitle' | 'note', to: string | null): ExplainerDoc {
  const out = clone(doc);
  if (field === 'title') out.scene.title = to ?? '';
  else if (field === 'subtitle') out.scene.subtitle = to;
  else out.scene.note = to;
  return out;
}

export function addSceneRow(doc: ExplainerDoc, row: Row): ExplainerDoc {
  const out = clone(doc);
  out.scene.rows.push({ ...row });
  return out;
}

export function setSceneRow(doc: ExplainerDoc, rowId: string, patch: Partial<Row>): ExplainerDoc {
  const out = clone(doc);
  const row = out.scene.rows.find((r) => r.id === rowId);
  if (row) Object.assign(row, patch);
  return out;
}

export function removeSceneRow(doc: ExplainerDoc, rowId: string): ExplainerDoc {
  const out = clone(doc);
  out.scene.rows = out.scene.rows.filter((r) => r.id !== rowId);
  out.scene.links = out.scene.links.filter((l) => l.from !== rowId && l.to !== rowId);
  return out;
}

/** Matching is on the pair, so restating a link edits the one already drawn. */
export function setSceneLink(
  doc: ExplainerDoc, from: string, to: string, state: RowState, label: string | null | undefined
): ExplainerDoc {
  const out = clone(doc);
  const existing = out.scene.links.find((l) => l.from === from && l.to === to);
  if (existing) {
    existing.state = state;
    if (label !== undefined) existing.label = label;
  } else {
    out.scene.links.push({ from, to, label: label ?? null, state } as Link);
  }
  return out;
}

export function addScenePanel(doc: ExplainerDoc, text: string, state: RowState): ExplainerDoc {
  const out = clone(doc);
  out.scene.panel.push({ text, state });
  return out;
}

/** `b1`, `b2`, … skipping anything taken, so ids stay readable and stay unique. */
function freeBeatId(doc: ExplainerDoc): string {
  const taken = new Set(doc.beats.map((b) => b.id));
  for (let n = 1; ; n += 1) {
    const id = `b${n}`;
    if (!taken.has(id)) return id;
  }
}

export function addBeat(doc: ExplainerDoc, role: Role, after: string | undefined): ExplainerDoc {
  const out = clone(doc);
  const beat = { id: freeBeatId(doc), role, sec: null, mutations: [] as Mutation[] };
  const at = after ? out.beats.findIndex((b) => b.id === after) : -1;
  if (at === -1) out.beats.push(beat);
  else out.beats.splice(at + 1, 0, beat);
  return out;
}

export function removeBeat(doc: ExplainerDoc, beatId: string): ExplainerDoc {
  const out = clone(doc);
  out.beats = out.beats.filter((b) => b.id !== beatId);
  return out;
}

export function moveBeat(doc: ExplainerDoc, beatId: string, toIndex: number): ExplainerDoc {
  const out = clone(doc);
  const from = out.beats.findIndex((b) => b.id === beatId);
  if (from === -1) return out;
  const [beat] = out.beats.splice(from, 1);
  out.beats.splice(Math.max(0, Math.min(toIndex, out.beats.length)), 0, beat);
  return out;
}

export function setBeatSec(doc: ExplainerDoc, beatId: string, sec: number | null): ExplainerDoc {
  const out = clone(doc);
  const beat = out.beats.find((b) => b.id === beatId);
  if (beat) beat.sec = sec;
  return out;
}

export function setBeatRole(doc: ExplainerDoc, beatId: string, role: Role): ExplainerDoc {
  const out = clone(doc);
  const beat = out.beats.find((b) => b.id === beatId);
  if (beat) beat.role = role;
  return out;
}

export function addMutation(doc: ExplainerDoc, beatId: string, mutation: Mutation): ExplainerDoc {
  const out = clone(doc);
  out.beats.find((b) => b.id === beatId)?.mutations.push(mutation);
  return out;
}

export function updateMutation(doc: ExplainerDoc, beatId: string, index: number, mutation: Mutation): ExplainerDoc {
  const out = clone(doc);
  const beat = out.beats.find((b) => b.id === beatId);
  if (beat && beat.mutations[index]) beat.mutations[index] = mutation;
  return out;
}

export function removeMutation(doc: ExplainerDoc, beatId: string, index: number): ExplainerDoc {
  const out = clone(doc);
  const beat = out.beats.find((b) => b.id === beatId);
  if (beat) beat.mutations = beat.mutations.filter((_, i) => i !== index);
  return out;
}

export function moveMutation(doc: ExplainerDoc, beatId: string, from: number, to: number): ExplainerDoc {
  const out = clone(doc);
  const beat = out.beats.find((b) => b.id === beatId);
  if (!beat || !beat.mutations[from]) return out;
  const [m] = beat.mutations.splice(from, 1);
  beat.mutations.splice(Math.max(0, Math.min(to, beat.mutations.length)), 0, m);
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/explainer.edits.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/explainer/edits.ts tests/explainer.edits.test.ts
git commit -m "feat(explainer): the pure edits

Seventeen functions over a document, each returning a new one. No
validation here on purpose: the registry above owns argument parsing,
the reference checks and the fold. Keeping this layer dumb is what lets
it be read at a glance."
```

---

### Task 3: The command registry

The registry, `applyOne`, and the fold post-condition that makes an unrenderable document
impossible to store.

**Files:**
- Create: `lib/explainer/commands.ts`
- Test: `tests/explainer.commands.test.ts`

**Interfaces:**
- Consumes: everything from Task 2; `foldDoc`, `FoldError`, `ExplainerDocSchema`, `RowSchema`,
  `MutationSchema`, `ROW_STATES`, `ICONS`, `ROLES` from `./schema`.
- Produces: `COMMANDS`, `CommandName`, `CommandInput`, `CommandError`,
  `applyOne(doc, input) -> { doc, op, summary, args }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/explainer.commands.test.ts
import { describe, expect, it } from 'vitest';
import { COMMANDS, CommandError, applyOne } from '@/lib/explainer/commands';
import { ExplainerDocSchema, type ExplainerDoc } from '@/lib/explainer/schema';

const doc = (): ExplainerDoc => ExplainerDocSchema.parse({
  template: 'explainer',
  theme: 'midnight',
  brand: { handle: '@stackframe', name: 'Stack Frame' },
  scene: {
    title: 'Caching',
    rows: [{ id: 'app', label: 'App' }, { id: 'db', label: 'Database', value: 200, unit: ' ms' }],
    links: [],
    panel: [],
  },
  beats: [
    { id: 'b1', role: 'hook', mutations: [] },
    { id: 'b2', role: 'payoff', mutations: [{ op: 'set', row: 'db', value: 2 }] },
  ],
});

const run = (d: ExplainerDoc, op: string, args: unknown) => applyOne(d, { op, args, actor: 'ui' });

describe('the registry', () => {
  it('applies a command and summarises it', () => {
    const out = run(doc(), 'doc.theme', { theme: 'paper' });
    expect(out.doc.theme).toBe('paper');
    expect(out.summary).toContain('paper');
  });

  it('rejects an unknown op and says which ops exist', () => {
    try {
      run(doc(), 'doc.explode', {});
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as CommandError;
      expect(err.status).toBe(400);
      expect(err.detail.validOps).toContain('doc.theme');
    }
  });

  it('rejects a bad argument and hands back the schema', () => {
    try {
      run(doc(), 'beat.sec', { beatId: 'b1', sec: 'soon' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as CommandError;
      expect(err.status).toBe(400);
      expect(err.detail.schema).toBeDefined();
    }
  });

  it('rejects a beat id that is not on the document, listing the ones that are', () => {
    try {
      run(doc(), 'beat.sec', { beatId: 'b9', sec: 2 });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as CommandError;
      expect(err.status).toBe(404);
      expect(err.detail.validIds).toEqual(['b1', 'b2']);
    }
  });

  it('every command in the registry names an edit that exists', async () => {
    const edits = await import('@/lib/explainer/edits');
    for (const [name, spec] of Object.entries(COMMANDS)) {
      expect(typeof (edits as Record<string, unknown>)[spec.fn], `${name} -> ${spec.fn}`).toBe('function');
    }
  });
});

describe('the fold post-condition', () => {
  it('refuses a move that strips a dependency, naming the beat', () => {
    // b2 sets a row the scene already has, so give b1 the add and then move b2 above it.
    const d = run(
      run(doc(), 'mutation.add', {
        beatId: 'b1',
        mutation: { op: 'add', row: { id: 'edge', label: 'Edge' } },
      }).doc,
      'mutation.add',
      { beatId: 'b2', mutation: { op: 'set', row: 'edge', state: 'good' } }
    ).doc;

    try {
      run(d, 'beat.move', { beatId: 'b2', toIndex: 0 });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as CommandError;
      expect(err.status).toBe(422);
      expect(err.detail.beatId).toBe('b2');
      expect(err.message).toContain('edge');
    }
  });

  it('refuses a document that is no longer valid', () => {
    try {
      run(doc(), 'doc.replace', { doc: { template: 'explainer', theme: 'midnight' } });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CommandError).status).toBe(400);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explainer.commands.test.ts`
Expected: FAIL — cannot resolve `@/lib/explainer/commands`.

- [ ] **Step 3: Write the registry**

```ts
// lib/explainer/commands.ts
import { z } from 'zod';
import * as edits from './edits';
import {
  ExplainerDocSchema, FoldError, ICONS, MutationSchema, ROLES, ROW_STATES, RowSchema, foldDoc,
  type ExplainerDoc,
} from './schema';
import type { Actor } from './history';

/**
 * The single write path into an explainer.
 *
 * Every edit is a named command with a declared argument schema, so the studio and an agent reach
 * the same operations through the same door. Two paths into one document drift; one cannot.
 */

type Command = {
  /** Name of the `edits.ts` function this wraps. A test pins the correspondence. */
  fn: keyof typeof edits;
  args: z.ZodTypeAny;
  /** Beat ids to resolve against the document before the command runs. */
  beatRef?: string;
  apply: (doc: ExplainerDoc, args: never) => ExplainerDoc;
  summary: (args: never) => string;
};

function command<S extends z.ZodTypeAny>(c: {
  fn: keyof typeof edits;
  args: S;
  beatRef?: string;
  apply: (doc: ExplainerDoc, args: z.infer<S>) => ExplainerDoc;
  summary: (args: z.infer<S>) => string;
}): Command {
  return c as unknown as Command;
}

const rowPatchFields = {
  label: z.string().max(28).optional(),
  value: z.number().nullable().optional(),
  unit: z.string().max(8).optional(),
  sub: z.string().max(40).nullable().optional(),
  state: z.enum(ROW_STATES).optional(),
  tier: z.number().int().min(0).max(3).optional(),
  col: z.number().int().min(0).max(5).optional(),
  icon: z.enum(ICONS).optional(),
};

export const COMMANDS = {
  'doc.theme': command({
    fn: 'setTheme',
    args: z.object({ theme: z.string().min(1) }),
    apply: (d, a) => edits.setTheme(d, a.theme),
    summary: (a) => `theme ${a.theme}`,
  }),
  'doc.replace': command({
    fn: 'replaceDoc',
    args: z.object({ doc: ExplainerDocSchema }),
    apply: (d, a) => edits.replaceDoc(d, a.doc),
    summary: () => 'replace the document',
  }),
  'scene.text': command({
    fn: 'setSceneText',
    args: z.object({ field: z.enum(['title', 'subtitle', 'note']), to: z.string().max(90).nullable() }),
    apply: (d, a) => edits.setSceneText(d, a.field, a.to),
    summary: (a) => `set ${a.field}`,
  }),
  'scene.row.add': command({
    fn: 'addSceneRow',
    args: z.object({ row: RowSchema }),
    apply: (d, a) => edits.addSceneRow(d, a.row),
    summary: (a) => `add row "${a.row.id}"`,
  }),
  'scene.row.set': command({
    fn: 'setSceneRow',
    args: z.object({ rowId: z.string().min(1), ...rowPatchFields }),
    // rowId is destructured out: it addresses the row, it is not a field on it, and passing the
    // whole args object as the patch would write a stray rowId onto the row.
    apply: (d, { rowId, ...patch }) => edits.setSceneRow(d, rowId, patch),
    summary: (a) => `change row "${a.rowId}"`,
  }),
  'scene.row.remove': command({
    fn: 'removeSceneRow',
    args: z.object({ rowId: z.string().min(1) }),
    apply: (d, a) => edits.removeSceneRow(d, a.rowId),
    summary: (a) => `remove row "${a.rowId}"`,
  }),
  'scene.link': command({
    fn: 'setSceneLink',
    args: z.object({
      from: z.string().min(1), to: z.string().min(1),
      state: z.enum(ROW_STATES).default('idle'),
      label: z.string().max(16).nullable().optional(),
    }),
    apply: (d, a) => edits.setSceneLink(d, a.from, a.to, a.state, a.label),
    summary: (a) => `link ${a.from} to ${a.to}`,
  }),
  'scene.panel.add': command({
    fn: 'addScenePanel',
    args: z.object({ text: z.string().min(1).max(48), state: z.enum(ROW_STATES).default('idle') }),
    apply: (d, a) => edits.addScenePanel(d, a.text, a.state),
    summary: (a) => `panel "${a.text}"`,
  }),
  'beat.add': command({
    fn: 'addBeat',
    args: z.object({ role: z.enum(ROLES), after: z.string().min(1).optional() }),
    apply: (d, a) => edits.addBeat(d, a.role, a.after),
    summary: (a) => `add a ${a.role} beat`,
  }),
  'beat.remove': command({
    fn: 'removeBeat',
    args: z.object({ beatId: z.string().min(1) }),
    beatRef: 'beatId',
    apply: (d, a) => edits.removeBeat(d, a.beatId),
    summary: (a) => `remove ${a.beatId}`,
  }),
  'beat.move': command({
    fn: 'moveBeat',
    args: z.object({ beatId: z.string().min(1), toIndex: z.number().int().min(0) }),
    beatRef: 'beatId',
    apply: (d, a) => edits.moveBeat(d, a.beatId, a.toIndex),
    summary: (a) => `move ${a.beatId}`,
  }),
  'beat.sec': command({
    fn: 'setBeatSec',
    args: z.object({ beatId: z.string().min(1), sec: z.number().gt(0).max(30).nullable() }),
    beatRef: 'beatId',
    apply: (d, a) => edits.setBeatSec(d, a.beatId, a.sec),
    summary: (a) => (a.sec === null ? `${a.beatId} back to its default length` : `${a.beatId} to ${a.sec}s`),
  }),
  'beat.role': command({
    fn: 'setBeatRole',
    args: z.object({ beatId: z.string().min(1), role: z.enum(ROLES) }),
    beatRef: 'beatId',
    apply: (d, a) => edits.setBeatRole(d, a.beatId, a.role),
    summary: (a) => `${a.beatId} is now a ${a.role}`,
  }),
  'mutation.add': command({
    fn: 'addMutation',
    args: z.object({ beatId: z.string().min(1), mutation: MutationSchema }),
    beatRef: 'beatId',
    apply: (d, a) => edits.addMutation(d, a.beatId, a.mutation),
    summary: (a) => `${a.beatId}: ${a.mutation.op}`,
  }),
  'mutation.update': command({
    fn: 'updateMutation',
    args: z.object({ beatId: z.string().min(1), index: z.number().int().min(0), mutation: MutationSchema }),
    beatRef: 'beatId',
    apply: (d, a) => edits.updateMutation(d, a.beatId, a.index, a.mutation),
    summary: (a) => `${a.beatId}: change ${a.mutation.op}`,
  }),
  'mutation.remove': command({
    fn: 'removeMutation',
    args: z.object({ beatId: z.string().min(1), index: z.number().int().min(0) }),
    beatRef: 'beatId',
    apply: (d, a) => edits.removeMutation(d, a.beatId, a.index),
    summary: (a) => `${a.beatId}: drop one change`,
  }),
  'mutation.move': command({
    fn: 'moveMutation',
    args: z.object({ beatId: z.string().min(1), from: z.number().int().min(0), to: z.number().int().min(0) }),
    beatRef: 'beatId',
    apply: (d, a) => edits.moveMutation(d, a.beatId, a.from, a.to),
    summary: (a) => `${a.beatId}: reorder`,
  }),
} satisfies Record<string, Command>;

export type CommandName = keyof typeof COMMANDS;
export type CommandInput = { op: string; args: unknown; actor: Actor };

/**
 * Carries the HTTP status and a machine-readable detail, because an agent is a first-class caller
 * here: a rejection has to say what was wrong AND what valid input looks like.
 */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

/**
 * Runs one command against a document held in memory and returns the result.
 *
 * Everything that decides whether a command is legal lives here, so the dry run and the real write
 * path cannot disagree about what would happen. It touches no disk; persistence is the caller's.
 */
export function applyOne(
  doc: ExplainerDoc,
  input: CommandInput
): { doc: ExplainerDoc; op: string; summary: string; args: unknown } {
  const spec = (COMMANDS as Record<string, Command>)[input.op];
  if (!spec) {
    throw new CommandError(`unknown op "${input.op}"`, 400, { validOps: Object.keys(COMMANDS) });
  }

  const parsed = spec.args.safeParse(input.args);
  if (!parsed.success) {
    throw new CommandError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 400, {
      op: input.op,
      schema: z.toJSONSchema(spec.args),
    });
  }
  const args = parsed.data as Record<string, unknown>;

  if (spec.beatRef) {
    const ids = doc.beats.map((b) => b.id);
    if (!ids.includes(String(args[spec.beatRef]))) {
      throw new CommandError(`no beat "${String(args[spec.beatRef])}" on this explainer`, 404, { validIds: ids });
    }
  }

  const next = spec.apply(doc, parsed.data as never);

  let valid: ExplainerDoc;
  try {
    valid = ExplainerDocSchema.parse(next);
  } catch (err) {
    throw new CommandError(`"${input.op}" would leave the document invalid: ${String(err)}`, 400, {});
  }

  // The fold is a post-condition on every command: it is what makes it impossible to store a
  // document that cannot render. Moving a beat above the one that adds the row it sets is a
  // legal-looking edit, and this is where it fails.
  try {
    foldDoc(valid);
  } catch (err) {
    if (err instanceof FoldError) {
      throw new CommandError(`"${input.op}" would break beat ${err.beatId}: ${err.message}`, 422, {
        beatId: err.beatId,
      });
    }
    throw err;
  }

  return { doc: valid, op: input.op, summary: spec.summary(parsed.data as never), args: parsed.data };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/explainer.commands.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/explainer/commands.ts tests/explainer.commands.test.ts
git commit -m "feat(explainer): the command registry

One named command per edit, with a declared argument schema, so the
studio and an agent reach the same operations through the same door.
applyOne touches no disk, so the dry run and the real write cannot
disagree about what would happen.

The fold is a post-condition on every command. Moving a beat above the
one that adds the row it sets is a legal-looking edit that produces an
unrenderable document, and it now fails there, naming the beat."
```

---
### Task 4: Beat-relative row references

The one place this design departs from reels.

**Be clear about what this buys.** The fold post-condition from Task 3 already *catches* a mutation
naming a row that does not exist — it throws `FoldError` and the command is rejected. This task
does not add a guarantee; it upgrades the error. Instead of a 422 saying "row `edge` does not
exist yet", the caller gets a 404 listing the rows that **do** exist at that beat. For a human
that is the difference between a dead end and a next step, and for an agent it is the difference
between guessing and choosing.

**Files:**
- Modify: `lib/explainer/commands.ts`
- Test: `tests/explainer.commands.test.ts` (append)

**Interfaces:**
- Consumes: `applyBeat` from `./schema`; `COMMANDS`, `CommandError` from Task 3.
- Produces: no new exports. `applyOne` gains the check.

- [ ] **Step 1: Write the failing test**

Append to `tests/explainer.commands.test.ts`:

```ts
describe('row references are beat-relative', () => {
  /** `edge` is added at b2, so it exists at b3 and does not exist at b1. */
  const growing = (): ExplainerDoc => ExplainerDocSchema.parse({
    template: 'explainer',
    theme: 'midnight',
    brand: { handle: '@stackframe', name: 'Stack Frame' },
    scene: { title: 'Growing board', rows: [{ id: 'origin', label: 'Origin' }], links: [], panel: [] },
    beats: [
      { id: 'b1', role: 'hook', mutations: [] },
      { id: 'b2', role: 'step', mutations: [{ op: 'add', row: { id: 'edge', label: 'Edge' } }] },
      { id: 'b3', role: 'payoff', mutations: [] },
    ],
  });

  it('accepts a row that exists by the target beat', () => {
    const out = run(growing(), 'mutation.add', {
      beatId: 'b3',
      mutation: { op: 'set', row: 'edge', state: 'good' },
    });
    expect(out.doc.beats[2].mutations).toHaveLength(1);
  });

  it('rejects the same row at an earlier beat, listing what is on the board there', () => {
    try {
      run(growing(), 'mutation.add', { beatId: 'b1', mutation: { op: 'set', row: 'edge', state: 'good' } });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as CommandError;
      expect(err.status).toBe(404);
      expect(err.detail.validIds).toEqual(['origin']);
      expect(err.detail.beatId).toBe('b1');
    }
  });

  it('checks both ends of a link', () => {
    try {
      run(growing(), 'mutation.add', { beatId: 'b1', mutation: { op: 'link', from: 'origin', to: 'edge' } });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CommandError).detail.validIds).toEqual(['origin']);
    }
  });

  it('sees rows the same beat added before this mutation', () => {
    const d = run(growing(), 'mutation.add', {
      beatId: 'b1',
      mutation: { op: 'add', row: { id: 'cache', label: 'Cache' } },
    }).doc;
    const out = run(d, 'mutation.add', { beatId: 'b1', mutation: { op: 'set', row: 'cache', state: 'good' } });
    expect(out.doc.beats[0].mutations).toHaveLength(2);
  });

  it('lets `*` through, since it names no row in particular', () => {
    const out = run(growing(), 'mutation.add', { beatId: 'b1', mutation: { op: 'set', row: '*', state: 'good' } });
    expect(out.doc.beats[0].mutations).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explainer.commands.test.ts -t "beat-relative"`
Expected: FAIL — the rejection arrives as a 422 from the fold, not a 404 with `validIds`.

- [ ] **Step 3: Add the check**

Add to `lib/explainer/commands.ts`, importing `applyBeat` alongside the other schema imports:

```ts
/** The row ids a mutation names. `*` names none in particular, so it is not a reference. */
function rowsNamedBy(mutation: { op: string } & Record<string, unknown>): string[] {
  if (mutation.op === 'set') return mutation.row === '*' ? [] : [String(mutation.row)];
  if (mutation.op === 'link') return [String(mutation.from), String(mutation.to)];
  return [];
}

/**
 * The board as it stands at a beat, including anything that beat has already done.
 *
 * A row added at b2 does not exist at b1, so whether a mutation may name it depends on where its
 * beat sits. Checking against the union of every row the document ever holds would accept
 * mutations the renderer refuses; checking against the opening scene would reject correct ones.
 */
function boardAt(doc: ExplainerDoc, beatId: string): string[] {
  let scene = doc.scene;
  for (const beat of doc.beats) {
    scene = applyBeat(scene, beat);
    if (beat.id === beatId) break;
  }
  return scene.rows.map((r) => r.id);
}
```

And inside `applyOne`, after the `beatRef` check and before `spec.apply`:

```ts
  // Row references are beat-relative. The fold below would catch a bad one anyway; this exists to
  // reject it with the rows that are actually on the board at that point, rather than a bare
  // "does not exist yet".
  const named = args.mutation ? rowsNamedBy(args.mutation as { op: string } & Record<string, unknown>) : [];
  if (named.length && spec.beatRef) {
    const beatId = String(args[spec.beatRef]);
    const onBoard = boardAt(doc, beatId);
    const missing = named.find((id) => !onBoard.includes(id));
    if (missing) {
      throw new CommandError(`no row "${missing}" on the board at ${beatId}`, 404, {
        beatId,
        validIds: onBoard,
      });
    }
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/explainer.commands.test.ts`
Expected: 12 passed.

Note the fourth test — "sees rows the same beat added before this mutation" — passes because
`boardAt` folds *through* the target beat, so mutations already sitting in it are applied before
the check. A check that stopped short of the beat would reject a correct edit.

- [ ] **Step 5: Commit**

```bash
git add lib/explainer/commands.ts tests/explainer.commands.test.ts
git commit -m "feat(explainer): row references resolve at the beat that names them

Reels resolve an id against a flat lane; an explainer's board grows, so
a row added at b2 does not exist at b1 and whether a mutation may name
it depends on where its beat sits.

The fold would catch a bad reference anyway. This turns that into a 404
listing the rows that are on the board at that point, which is the
difference between a dead end and a next step - and, for an agent,
between guessing and choosing."
```

---

### Task 5: Persistence and the routes

`applyCommand` writes and logs; two routes put it on the network; the existing `PUT` becomes a
wrapper so there is no second write path.

**Files:**
- Modify: `lib/explainer/commands.ts` (append)
- Create: `app/api/explainers/[slug]/edit/route.ts`
- Create: `app/api/explainers/[slug]/history/route.ts`
- Modify: `app/api/explainers/[slug]/route.ts` (the `PUT` handler)
- Test: `tests/explainer.applyCommand.test.ts`

**Interfaces:**
- Consumes: `applyOne`, `CommandError` (Task 3); `history.push/read/undo/redo` (Task 1);
  `get`/`save` from `./store`; `foldDoc` from `./schema`.
- Produces: `loadDocOr404(slug)`, `applyCommand(slug, input) -> { doc, entry }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/explainer.applyCommand.test.ts
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'explainer-apply-'));
  process.env.IOLAR_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.IOLAR_DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('applyCommand', () => {
  it('writes the document and records the entry', async () => {
    const { applyCommand } = await import('@/lib/explainer/commands');
    const store = await import('@/lib/explainer/store');
    await store.save('x', store.blankDoc('Indexes', 'midnight'));

    const { doc, entry } = await applyCommand('x', { op: 'doc.theme', args: { theme: 'paper' }, actor: 'ui' });
    expect(doc.theme).toBe('paper');
    expect(entry.actor).toBe('ui');
    expect((await store.get('x'))!.theme).toBe('paper');
  });

  it('a rejected command writes nothing', async () => {
    const { applyCommand, CommandError } = await import('@/lib/explainer/commands');
    const store = await import('@/lib/explainer/store');
    await store.save('x', store.blankDoc('Indexes', 'midnight'));

    await expect(
      applyCommand('x', { op: 'beat.sec', args: { beatId: 'nope', sec: 2 }, actor: 'ui' })
    ).rejects.toBeInstanceOf(CommandError);
    expect((await store.get('x'))!.beats).toHaveLength(2);
  });

  it('404s for an explainer that is not there', async () => {
    const { applyCommand } = await import('@/lib/explainer/commands');
    await expect(
      applyCommand('ghost', { op: 'doc.theme', args: { theme: 'paper' }, actor: 'ui' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('undo puts the document back', async () => {
    const { applyCommand } = await import('@/lib/explainer/commands');
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', store.blankDoc('Indexes', 'midnight'));

    await applyCommand('x', { op: 'doc.theme', args: { theme: 'paper' }, actor: 'ui' });
    await history.undo('x');
    expect((await store.get('x'))!.theme).toBe('midnight');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explainer.applyCommand.test.ts`
Expected: FAIL — `applyCommand` is not exported.

- [ ] **Step 3: Append the persistence wrapper**

Add to the end of `lib/explainer/commands.ts`:

```ts
import * as history from './history';
import { get, save } from './store';

export async function loadDocOr404(slug: string): Promise<ExplainerDoc> {
  const doc = await get(slug);
  if (!doc) throw new CommandError(`no explainer "${slug}"`, 404, {});
  return doc;
}

export async function applyCommand(
  slug: string,
  input: CommandInput
): Promise<{ doc: ExplainerDoc; entry: history.Entry }> {
  const doc = await loadDocOr404(slug);
  const { doc: valid, summary, args: parsedArgs } = applyOne(doc, input);

  await save(slug, valid);

  // Deliberately after the save. A failed log entry must not cost the user their edit, so it is
  // reported and swallowed rather than thrown.
  const meta = { op: input.op, args: parsedArgs, actor: input.actor, summary };
  let entry: history.Entry = { seq: -1, at: new Date().toISOString(), ...meta };
  try {
    const log = await history.push(slug, doc, valid, meta);
    entry = log.entries[log.cursor - 1] ?? entry;
  } catch (err) {
    console.error(`[explainer] history write failed for ${slug}:`, err);
  }

  return { doc: valid, entry };
}
```

- [ ] **Step 4: Write the edit route**

```ts
// app/api/explainers/[slug]/edit/route.ts
import { NextResponse } from 'next/server';
import { COMMANDS, CommandError, applyCommand } from '@/lib/explainer/commands';
import { foldDoc } from '@/lib/explainer/schema';

/**
 * The one door every edit goes through, whoever is knocking.
 *
 * `actor` defaults to 'agent' because the studio always labels itself: anything that did not
 * bother to say is, by elimination, not the studio.
 */

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (typeof body?.op !== 'string') {
    return NextResponse.json(
      { error: 'body must be {op, args, actor?}', validOps: Object.keys(COMMANDS) },
      { status: 400 }
    );
  }

  try {
    const { doc, entry } = await applyCommand(slug, {
      op: body.op,
      args: body.args ?? {},
      actor: body.actor === 'ui' ? 'ui' : 'agent',
    });
    // The fold has already happened as a post-condition, so handing it back costs nothing and
    // saves the editor a round trip on every edit.
    const steps = foldDoc(doc).map((s) => ({
      id: s.beat.id, role: s.beat.role, startFrame: s.startFrame,
      durationFrames: s.durationFrames, mutations: s.beat.mutations.length, scene: s.scene,
    }));
    return NextResponse.json({ doc, entry, steps });
  } catch (err) {
    if (err instanceof CommandError) {
      return NextResponse.json({ error: err.message, ...err.detail }, { status: err.status });
    }
    throw err;
  }
}

export async function GET() {
  return NextResponse.json({ ops: Object.keys(COMMANDS) });
}
```

- [ ] **Step 5: Write the history route**

```ts
// app/api/explainers/[slug]/history/route.ts
import { NextResponse } from 'next/server';
import * as history from '@/lib/explainer/history';
import { foldDoc } from '@/lib/explainer/schema';

type Ctx = { params: Promise<{ slug: string }> };

const stepsOf = (doc: Parameters<typeof foldDoc>[0]) =>
  foldDoc(doc).map((s) => ({
    id: s.beat.id, role: s.beat.role, startFrame: s.startFrame,
    durationFrames: s.durationFrames, mutations: s.beat.mutations.length, scene: s.scene,
  }));

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  return NextResponse.json(await history.read(slug));
}

/** Undo and redo are the only moves; there is no jump-to-cursor and nothing has asked for one. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const body = await req.json().catch(() => ({}));
  const move = body?.move;
  if (move !== 'undo' && move !== 'redo') {
    return NextResponse.json({ error: "body must be {move: 'undo' | 'redo'}" }, { status: 400 });
  }

  try {
    const { doc } = move === 'undo' ? await history.undo(slug) : await history.redo(slug);
    return NextResponse.json({ doc, log: await history.read(slug), steps: stepsOf(doc) });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 409 });
  }
}
```

- [ ] **Step 6: Make PUT a wrapper**

In `app/api/explainers/[slug]/route.ts`, replace the body of `PUT` so the escape hatch goes
through a command and lands in history like everything else:

```ts
export async function PUT(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const body = await req.json().catch(() => null);
  try {
    const { doc } = await applyCommand(slug, { op: 'doc.replace', args: { doc: body }, actor: 'ui' });
    return NextResponse.json({ slug, doc, seconds: Math.round(totalSeconds(doc) * 10) / 10 });
  } catch (err) {
    if (err instanceof CommandError) {
      return NextResponse.json({ error: err.message, ...err.detail }, { status: err.status });
    }
    throw err;
  }
}
```

Import `applyCommand` and `CommandError` from `@/lib/explainer/commands` at the top of that file,
and drop the now-unused `ExplainerDocSchema`, `FoldError` and `save` imports if nothing else in
the file uses them.

- [ ] **Step 7: Run everything**

Run: `npx vitest run tests/explainer.applyCommand.test.ts`
Expected: 4 passed.

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint app/api/explainers lib/explainer`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add lib/explainer/commands.ts app/api/explainers tests/explainer.applyCommand.test.ts
git commit -m "feat(explainer): persist commands, and put them on the network

applyCommand saves then logs, in that order: a failed log entry must not
cost the user their edit, so it is reported and swallowed.

PUT becomes a thin wrapper over doc.replace, which removes a second
write path rather than adding one - the JSON escape hatch is now
undoable like every other edit.

Every response carries the folded board. The fold has already happened
as a post-condition, so handing it back costs nothing and saves the
editor a round trip on every keystroke."
```

---

### Task 6: Undo, redo, and the log on screen

The editor gains the two buttons the command layer exists to make possible, and a panel showing
what has been done.

**Files:**
- Create: `app/explainers/[slug]/useExplainerEditor.ts`
- Modify: `app/explainers/[slug]/page.tsx`

**Interfaces:**
- Consumes: the routes from Task 5.
- Produces: `useExplainerEditor(slug)` returning
  `{ data, log, busy, run(op, args), move('undo' | 'redo'), reload }`.

- [ ] **Step 1: Write the hook**

```ts
// app/explainers/[slug]/useExplainerEditor.ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import type { Scene } from '@/lib/explainer/schema';

export type Step = {
  id: string; role: string; startFrame: number; durationFrames: number; mutations: number; scene: Scene;
};
export type Loaded = {
  slug: string;
  doc: Record<string, unknown> & { theme: string };
  seconds: number | null;
  steps: Step[];
  foldError: { beatId: string; message: string } | null;
};
export type Entry = { seq: number; op: string; actor: 'ui' | 'agent'; at: string; summary: string };
export type Log = { cursor: number; entries: Entry[] };

/**
 * One way in and out of an explainer for the editor.
 *
 * Mirrors useReelEditor: every edit goes through `run`, which is the same door an agent uses, so
 * the two cannot drift. Responses carry the folded board, so the page never refetches to redraw.
 */
export function useExplainerEditor(slug: string) {
  const [data, setData] = useState<Loaded | null>(null);
  const [log, setLog] = useState<Log>({ cursor: 0, entries: [] });
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const [d, l] = await Promise.all([
      fetch(`/api/explainers/${slug}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/explainers/${slug}/history`, { cache: 'no-store' }).then((r) => r.json()),
    ]);
    if (!alive.current) return;
    setData(d);
    setLog(l);
  }, [slug]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => { alive.current = false; };
  }, [reload]);

  /** Every edit, from the studio, labelled as the studio. */
  const run = useCallback(async (op: string, args: unknown) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/explainers/${slug}/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, args, actor: 'ui' }),
      });
      const body = await r.json();
      if (!r.ok) {
        message.error(body.beatId ? `${body.beatId}: ${body.error}` : (body.error ?? 'that edit was refused'));
        return false;
      }
      await reload();
      return true;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [slug, reload]);

  const move = useCallback(async (dir: 'undo' | 'redo') => {
    setBusy(true);
    try {
      const r = await fetch(`/api/explainers/${slug}/history`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ move: dir }),
      });
      const body = await r.json();
      if (!r.ok) { message.info(body.error ?? `nothing to ${dir}`); return; }
      await reload();
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [slug, reload]);

  return { data, log, busy, run, move, reload };
}
```

- [ ] **Step 2: Wire it into the page**

In `app/explainers/[slug]/page.tsx`, replace the local `apply` / `reload` / mount effect with the
hook, and add the two buttons beside Save and Render in the header:

```tsx
const { data, log, busy, move, reload } = useExplainerEditor(slug);
```

```tsx
<Button onClick={() => void move('undo')} disabled={busy || log.cursor === 0}>Undo</Button>
<Button onClick={() => void move('redo')} disabled={busy || log.cursor >= log.entries.length}>Redo</Button>
```

And a panel under the beat list:

```tsx
<Card size="small" title="History" styles={{ body: { padding: 0, maxHeight: 220, overflowY: 'auto' } }}>
  {log.entries.length === 0 ? (
    <div style={{ padding: '10px 14px', opacity: 0.6, fontSize: 12 }}>Nothing yet.</div>
  ) : (
    log.entries.map((e, i) => (
      <div
        key={e.seq}
        style={{
          padding: '8px 14px', fontSize: 12,
          opacity: i < log.cursor ? 1 : 0.4,
          borderBottom: '1px solid rgba(128,128,128,.12)',
        }}
      >
        <Tag color={e.actor === 'agent' ? 'purple' : 'default'} style={{ marginInlineEnd: 6 }}>{e.actor}</Tag>
        {e.summary}
      </div>
    ))
  )}
</Card>
```

Entries past the cursor are dimmed rather than hidden: after an undo you can see what redo would
bring back. When the scripting layer lands, an AI pass appears here as a run of purple `agent`
rows that can be stepped back through one at a time.

Keep the existing Save button: it still `PUT`s the textarea, which now goes through `doc.replace`
and appears in this list like anything else.

- [ ] **Step 3: Check it**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint app/explainers`
Expected: no output.

Run: `npx vitest run`
Expected: everything green — this task adds no tests, and must break none.

- [ ] **Step 4: Try it by hand**

Start the studio (`npm run dev`) and open **`http://localhost:3100/explainers`** — not
`127.0.0.1`, which Next treats as a foreign origin and whose dev bundle it silently blocks, so the
page renders but never hydrates.

Open an explainer, change the theme, and confirm the history panel gains a row, Undo restores the
previous theme, and Redo puts it back.

- [ ] **Step 5: Commit**

```bash
git add app/explainers
git commit -m "feat(explainers): undo, redo, and the log on screen

The two buttons the command layer exists to make possible, and a panel
showing what has been done. Entries past the cursor are dimmed rather
than hidden, so after an undo you can see what redo would bring back.

Each row carries its actor. Nothing writes as an agent yet; when the
scripting layer lands, an AI pass will appear here as a run of rows that
can be stepped back through one at a time."
```

---

## After this plan

The write path exists and is the only one. The three subsystems the spec names as out of scope
become possible in this order:

1. **Render as a job** — independent of this, and it fixes a real flaw: `POST /render` still holds
   the request open for the length of the render while every other category submits and polls.
2. **The scripting layer** — the four inputs, `revise` with diff-approve, and the fit report. It
   writes through these commands as `agent`, which is why the actor is recorded from the start.
3. **The editor rework** — beat rail, click-to-select nodes, a form inspector, a timeline. It
   consumes all three before it, which is why it is last.
