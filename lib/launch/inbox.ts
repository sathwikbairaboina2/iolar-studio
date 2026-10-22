import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { launchInboxDir, launchWatchStateFile } from '@/lib/paths';

/**
 * Reference reels found by the daily watch: one JSON per reel in `data/launch/inbox/`, plus a small state file that
 * remembers which reels were already looked at. A reference supplies the topic and the pacing of our reel, never its words.
 */

export const SHOT_KINDS = ['talk', 'screen', 'broll', 'text', 'unknown'] as const;

export const ReferenceSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{5,20}$/),
  creator: z.string(),
  postedAt: z.string(),
  url: z.string(),
  caption: z.string(),
  topic: z.string(),
  transcript: z.string(),
  note: z.string().optional(),
  durationSec: z.number(),
  shots: z.array(z.object({ start: z.number(), end: z.number(), kind: z.enum(SHOT_KINDS) })),
  status: z.enum(['new', 'made', 'dismissed']),
  slug: z.string().optional(),
  foundAt: z.string(),
});
export type Reference = z.infer<typeof ReferenceSchema>;

export const WatchStateSchema = z.object({
  lastRunAt: z.string().nullable(),
  lastDay: z.string().nullable(),
  seen: z.array(z.string()),
  skipped: z.object({ at: z.string(), reason: z.string() }).nullable(),
  running: z.boolean(),
});
export type WatchState = z.infer<typeof WatchStateSchema>;

export const isReferenceId = (id: string) => /^[A-Za-z0-9_-]{5,20}$/.test(id);
const refFile = (id: string) => path.join(launchInboxDir(), `${id}.json`);

export async function readReference(id: string): Promise<Reference | null> {
  if (!isReferenceId(id)) return null;
  try {
    return ReferenceSchema.parse(JSON.parse(await fs.readFile(refFile(id), 'utf8')));
  } catch {
    return null;
  }
}

export async function writeReference(ref: Reference): Promise<void> {
  const parsed = ReferenceSchema.parse(ref);
  await fs.mkdir(launchInboxDir(), { recursive: true });
  await fs.writeFile(refFile(parsed.id), JSON.stringify(parsed, null, 2));
}

/** Newest `postedAt` first. Files that do not parse are skipped. */
export async function listReferences(): Promise<Reference[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(launchInboxDir());
  } catch {
    return [];
  }
  const refs = await Promise.all(names.filter((n) => n.endsWith('.json')).map((n) => readReference(n.slice(0, -5))));
  return refs.filter((r): r is Reference => r !== null).sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

export async function setReferenceStatus(id: string, status: Reference['status'], slug?: string): Promise<Reference | null> {
  const ref = await readReference(id);
  if (!ref) return null;
  const next: Reference = { ...ref, status, ...(slug ? { slug } : {}) };
  await writeReference(next);
  return next;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How fast the reference cuts: the first shot is its hook; the median shot length is its rhythm. */
export function pacingOf(ref: Pick<Reference, 'shots'>): { hookSec: number; medianShotSec: number; shots: number } {
  const lens = ref.shots.map((s) => s.end - s.start);
  if (!lens.length) return { hookSec: 0, medianShotSec: 0, shots: 0 };
  const sorted = [...lens].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { hookSec: round2(lens[0]), medianShotSec: round2(median), shots: lens.length };
}

const EMPTY_STATE: WatchState = { lastRunAt: null, lastDay: null, seen: [], skipped: null, running: false };

export async function readWatchState(): Promise<WatchState> {
  try {
    return WatchStateSchema.parse(JSON.parse(await fs.readFile(launchWatchStateFile(), 'utf8')));
  } catch {
    return { ...EMPTY_STATE, seen: [] };
  }
}

export async function writeWatchState(s: WatchState): Promise<void> {
  await fs.mkdir(path.dirname(launchWatchStateFile()), { recursive: true });
  await fs.writeFile(launchWatchStateFile(), JSON.stringify(WatchStateSchema.parse(s), null, 2));
}
