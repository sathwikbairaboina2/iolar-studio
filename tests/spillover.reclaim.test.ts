import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function post(n: number, prefix = 'P', extra: object = {}) {
  return {
    brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'S', date: 'd',
    slides: Array.from({ length: n }, (_, i) => ({ page_title: `${prefix}${i + 1}`, blocks: [{ type: 'heading', text: `H${i + 1}` }] })),
    caption: { text: 'c', hashtags: [] },
    ...extra,
  };
}

async function setup(a: number, b: number, followExtra: object = { spilledFrom: 1 }) {
  const { createSubject, createChapter, createPart } = await import('@/lib/store');
  await createSubject('s', { name: 'S' });
  await createChapter('s', 'c', 'C');
  await createPart('s', 'c', 1, post(a) as never);
  await createPart('s', 'c', 2, post(b, 'F', followExtra) as never);
}

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-reclaim-'));
});

describe('reclaimFollowUp', () => {
  it('moves a 1-page follow-up back into a 17-page part: 18 pages, part 2 gone', async () => {
    await setup(17, 1);
    const { reclaimFollowUp } = await import('@/lib/ai/spillover');
    const { loadPost, listParts } = await import('@/lib/store');
    const { partDir } = await import('@/lib/paths');
    expect(await reclaimFollowUp('s', 'c', 1)).toEqual({ part: 2, moved: 1 });
    const p = await loadPost('s', 'c', 1);
    expect(p.slides).toHaveLength(18);
    expect(p.slides[17].page_title).toBe('F1');
    expect(await listParts('s', 'c')).toEqual([1]);
    expect(existsSync(partDir('s', 'c', 2))).toBe(false);
  });

  it('leaves an exported follow-up alone', async () => {
    await setup(17, 1);
    const { exportDir } = await import('@/lib/paths');
    mkdirSync(exportDir('s', 'c', 2), { recursive: true });
    writeFileSync(path.join(exportDir('s', 'c', 2), 'x.txt'), 'x');
    const { reclaimFollowUp } = await import('@/lib/ai/spillover');
    const { listParts } = await import('@/lib/store');
    expect(await reclaimFollowUp('s', 'c', 1)).toBeNull();
    expect(await listParts('s', 'c')).toEqual([1, 2]);
  });

  it('leaves 15 + 6 alone: it would pass the page limit', async () => {
    await setup(15, 6);
    const { reclaimFollowUp } = await import('@/lib/ai/spillover');
    const { loadPost } = await import('@/lib/store');
    expect(await reclaimFollowUp('s', 'c', 1)).toBeNull();
    expect((await loadPost('s', 'c', 1)).slides).toHaveLength(15);
  });

  it('leaves a part that was not made by a spill from this one', async () => {
    await setup(10, 2, {});
    const { reclaimFollowUp } = await import('@/lib/ai/spillover');
    expect(await reclaimFollowUp('s', 'c', 1)).toBeNull();
  });

  it('leaves a follow-up that has a follow-up of its own', async () => {
    await setup(10, 2);
    const { createPart } = await import('@/lib/store');
    await createPart('s', 'c', 3, post(1, 'G', { spilledFrom: 2 }) as never);
    const { reclaimFollowUp } = await import('@/lib/ai/spillover');
    expect(await reclaimFollowUp('s', 'c', 1)).toBeNull();
  });
});
