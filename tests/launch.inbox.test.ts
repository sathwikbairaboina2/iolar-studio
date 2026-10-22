import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { listReferences, pacingOf, readReference, readWatchState, setReferenceStatus, writeReference, writeWatchState } from '@/lib/launch/inbox';

const ref = (id: string, postedAt: string) => ({ id, creator: 'varunmayya', postedAt, url: `https://instagram.com/reel/${id}`, caption: 'Gemini 4 is here', topic: 'Gemini 4 launch', transcript: '', durationSec: 40,
  shots: [{ start: 0, end: 2.5, kind: 'talk' as const }, { start: 2.5, end: 6, kind: 'screen' as const }, { start: 6, end: 9, kind: 'broll' as const }, { start: 9, end: 40, kind: 'talk' as const }],
  status: 'new' as const, foundAt: '2026-10-21T09:00:00Z' });

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-inbox-'));
});

describe('pacingOf', () => {
  it('takes the first shot as the hook and the median shot length', () => {
    expect(pacingOf(ref('AAAAA1', '2026-10-21T08:00:00Z'))).toEqual({ hookSec: 2.5, medianShotSec: 3.25, shots: 4 });
  });
  it('uses the middle value for an odd count and copes with no shots', () => {
    const r = ref('AAAAA1', '2026-10-21T08:00:00Z');
    expect(pacingOf({ ...r, shots: r.shots.slice(0, 3) }).medianShotSec).toBe(3);
    expect(pacingOf({ ...r, shots: [] })).toEqual({ hookSec: 0, medianShotSec: 0, shots: 0 });
  });
});

describe('inbox', () => {
  it('lists newest first and records what became of a reference', async () => {
    await writeReference(ref('AAAAA1', '2026-10-20T08:00:00Z'));
    await writeReference(ref('BBBBB2', '2026-10-21T08:00:00Z'));
    await setReferenceStatus('AAAAA1', 'made', 'gemini-4');
    const list = await listReferences();
    expect(list.map((r) => r.id)).toEqual(['BBBBB2', 'AAAAA1']);
    expect(list[1]).toMatchObject({ status: 'made', slug: 'gemini-4' });
  });
  it('refuses ids that are not shortcodes and returns null for a missing one', async () => {
    await expect(writeReference(ref('../evil', '2026-10-20T08:00:00Z'))).rejects.toThrow();
    expect(await readReference('../evil')).toBeNull();
    expect(await readReference('ZZZZZ9')).toBeNull();
  });
  it('keeps the watch state, with defaults when there is none', async () => {
    expect(await readWatchState()).toEqual({ lastRunAt: null, lastDay: null, seen: [], skipped: null, running: false });
    await writeWatchState({ lastRunAt: 'x', lastDay: '2026-10-21', seen: ['AAAAA1'], skipped: null, running: false });
    expect((await readWatchState()).seen).toEqual(['AAAAA1']);
  });
});
