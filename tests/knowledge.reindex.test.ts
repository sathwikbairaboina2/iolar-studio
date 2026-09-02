import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';

let graph: FakeGraph;
beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-reindex-'));
  graph = new FakeGraph();
  useStoresForTests({ graph, vectors: new FakeVectors(), embed: new FakeEmbed() });
});

describe('reindex', () => {
  it('replays a reel research folder through the writers and counts it', async () => {
    const dir = path.join(process.env.IOLAR_DATA_DIR!, 'reel', 'r1', 'research');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'brief.json'),
      JSON.stringify({
        runId: 'r1',
        createdAt: '2026-09-02T00:00:00.000Z',
        topic: 'Topic one',
        angle: 'a',
        audience: 'b',
        videoFormat: 'reel',
        mustProve: ['claim one', 'claim two'],
        mustInclude: [],
        avoid: [],
        recencyWindowDays: 30,
        sourceClasses: ['docs'],
        searchQueries: [{ class: 'docs', queries: ['q'] }],
        referenceReel: null,
        status: 'briefed',
      })
    );
    const { reindexKnowledge } = await import('@/lib/knowledge/reindex');
    const out = await reindexKnowledge({ spaces: ['reels'], wipe: true });
    expect(out.reels).toBe(1);
    expect(graph.node('Reel', { slug: 'r1' })).toBeTruthy();
  });

  it('wipes only the spaces it was asked to', async () => {
    await graph.mergeNode('Week', { week: '2026-W01' }, { space: 'jobs' });
    const { reindexKnowledge } = await import('@/lib/knowledge/reindex');
    await reindexKnowledge({ spaces: ['reels'], wipe: true });
    expect(graph.node('Week', { week: '2026-W01' })).toBeTruthy();
  });

  it('skips jobs with a note when the board is down, and still finishes', async () => {
    vi.doMock('@/lib/jobs/board', () => ({
      listWeeks: async () => {
        throw new Error('board down');
      },
      readWeek: async () => {
        throw new Error('x');
      },
    }));
    const notes: string[] = [];
    const { reindexKnowledge } = await import('@/lib/knowledge/reindex');
    const out = await reindexKnowledge({ spaces: ['jobs'], wipe: false, log: (s) => notes.push(s) });
    expect(out.jobs).toBe(0);
    expect(notes.some((n) => /jobs skipped: board down/.test(n))).toBe(true);
  });
});
