import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Research lives beside the reel it belongs to, so one slug owns the whole life
 * from topic to export. The run directory is the state machine.
 */

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-research-'));
});

const brief = (over: Record<string, unknown> = {}) => ({
  runId: 'grok',
  createdAt: '2026-08-30T21:40:00.000Z',
  topic: 'LTX-Video open weights',
  angle: 'Open weights turn a per-pull lottery into a fixed hardware cost',
  audience: 'developers who self-host',
  videoFormat: 'reel',
  mustProve: ['the weights are genuinely open', 'local inference is unlimited'],
  mustInclude: ['Lightricks'],
  avoid: [],
  recencyWindowDays: 90,
  sourceClasses: ['github', 'news'],
  searchQueries: [{ class: 'github', queries: ['LTX-Video'] }],
  referenceReel: null,
  status: 'briefed',
  ...over,
});

describe('research store', () => {
  it('round-trips a brief', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeBrief('grok', brief() as never);

    expect((await store.readBrief('grok')).topic).toBe('LTX-Video open weights');
  });

  it('keeps research beside the reel it belongs to', async () => {
    const store = await import('@/lib/reel/research/store');
    const { reelDir } = await import('@/lib/paths');
    await store.writeBrief('grok', brief() as never);

    expect(store.researchDir('grok').startsWith(reelDir('grok'))).toBe(true);
  });

  it('reports no research rather than inventing an empty one', async () => {
    const store = await import('@/lib/reel/research/store');

    await expect(store.readBrief('grok')).rejects.toThrow(/no research/i);
  });

  it('says where a run stopped', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeBrief('grok', brief({ status: 'critiqued' }) as never);

    expect(await store.researchStatus('grok')).toBe('critiqued');
  });

  it('reports no status at all for a reel that was never researched', async () => {
    const store = await import('@/lib/reel/research/store');

    expect(await store.researchStatus('grok')).toBeNull();
  });

  it('moves the status without disturbing the rest of the brief', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeBrief('grok', brief() as never);

    await store.setResearchStatus('grok', 'hunted');
    const after = await store.readBrief('grok');

    expect(after.status).toBe('hunted');
    expect(after.mustInclude).toEqual(['Lightricks']);
  });

  it('defaults the selection to empty rather than failing', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeBrief('grok', brief() as never);

    expect((await store.readSelection('grok')).decisions).toEqual({});
  });

  it('round-trips a script', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeBrief('grok', brief() as never);
    await store.writeScript('grok', {
      runId: 'grok',
      createdAt: '2026-08-30T21:40:00.000Z',
      updatedAt: '2026-08-30T21:40:00.000Z',
      status: 'draft',
      lines: [
        {
          id: 'l1',
          order: 0,
          role: 'hook',
          text: 'Open weights changed the maths.',
          citations: ['a1b2c3d4e5f6'],
          assetIds: [],
          note: null,
          commentary: false,
        },
      ],
      unsupported: [],
    } as never);

    expect((await store.readScript('grok')).lines[0].text).toBe('Open weights changed the maths.');
  });

  it('stores one evidence file per source, keyed by candidate', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeEvidence('grok', {
      candidateId: 'a1b2c3d4e5f6',
      kind: 'transcript',
      retrievedAt: '2026-08-30T21:40:00.000Z',
      text: 'what was actually said',
      segments: [{ startSec: 1, endSec: 2, text: 'what was actually said' }],
    } as never);

    const all = await store.readAllEvidence('grok');
    expect(all['a1b2c3d4e5f6'].text).toBe('what was actually said');
  });

  it('returns no evidence rather than failing when nothing was gathered', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeBrief('grok', brief() as never);

    expect(await store.readAllEvidence('grok')).toEqual({});
  });
});
