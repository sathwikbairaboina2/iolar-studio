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

describe('reindex, explainers', () => {
  /** The document as the studio writes it: `data/explainer/<slug>/explainer.json`. */
  const writeExplainer = (slug: string, title: string, claim: string | null) => {
    const dir = path.join(process.env.IOLAR_DATA_DIR!, 'explainer', slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'explainer.json'),
      JSON.stringify({
        template: 'explainer',
        theme: 'blueprint',
        brand: { handle: '@stackframe', name: 'Stack Frame' },
        brief: claim ? { topic: title, audience: 'engineers', claim, seconds: 18 } : undefined,
        scene: {
          title,
          subtitle: null,
          rows: [
            { id: 'before', label: 'Origin Server', value: 100, unit: ' ms', state: 'warn' },
            { id: 'after', label: 'Edge Cache', value: 10, unit: ' ms', state: 'good' },
          ],
          links: [],
          panel: [{ text: 'RTT: 240ms', state: 'bad' }],
        },
        beats: [
          { id: 'b1', role: 'hook', mutations: [] },
          { id: 'b2', role: 'payoff', mutations: [{ op: 'set', row: 'after', value: 10, state: 'good' }] },
        ],
      })
    );
  };

  it('replays every explainer on disk through the writer and counts them', async () => {
    writeExplainer('cdn', 'What a CDN actually buys you', 'Cached bytes travel a shorter distance.');
    writeExplainer('pools', 'Connection Pools', 'A pool reuses the handshake you already paid for.');
    const { reindexKnowledge } = await import('@/lib/knowledge/reindex');
    const out = await reindexKnowledge({ spaces: ['explainers'], wipe: true });
    expect(out.explainers).toBe(2);
    expect(graph.node('Explainer', { slug: 'cdn' })?.props.title).toBe('What a CDN actually buys you');
    expect(graph.node('Explainer', { slug: 'pools' })).toBeTruthy();
  });

  it('indexes one without a brief rather than skipping it', async () => {
    writeExplainer('blank', 'No brief here', null);
    const { reindexKnowledge } = await import('@/lib/knowledge/reindex');
    const out = await reindexKnowledge({ spaces: ['explainers'], wipe: true });
    expect(out.explainers).toBe(1);
    expect(graph.node('Explainer', { slug: 'blank' })).toBeTruthy();
  });

  it('leaves the other spaces alone when it wipes its own', async () => {
    await graph.mergeNode('Reel', { slug: 'r9' }, { space: 'reels' });
    const { reindexKnowledge } = await import('@/lib/knowledge/reindex');
    await reindexKnowledge({ spaces: ['explainers'], wipe: true });
    expect(graph.node('Reel', { slug: 'r9' })).toBeTruthy();
  });
});
