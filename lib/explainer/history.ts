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
