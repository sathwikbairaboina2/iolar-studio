import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';
import { parseBrief } from '@/lib/reel/research/brief';

const brief = () =>
  parseBrief({
    runId: 'r',
    createdAt: '2026-09-02T00:00:00.000Z',
    topic: 'SQLite runs everything',
    angle: 'a',
    audience: 'b',
    videoFormat: 'reel',
    mustProve: ['SQLite ships in every major phone OS and browser', 'its test suite is orders of magnitude larger than the library'],
    mustInclude: [],
    avoid: [],
    recencyWindowDays: 365,
    sourceClasses: ['docs'],
    searchQueries: [{ class: 'docs', queries: ['q'] }],
    referenceReel: null,
    status: 'briefed',
  });

let graph: FakeGraph;
let vectors: FakeVectors;
const embed = new FakeEmbed();
beforeEach(() => {
  graph = new FakeGraph();
  vectors = new FakeVectors();
  useStoresForTests({ graph, vectors, embed });
});

describe('recallDomains', () => {
  it('ranks domains by kept minus rejected and lists walled ones separately', async () => {
    graph.answer(/Domain/, [
      { host: 'sqlite.org', kept: 5, rejected: 2, walled: 0 },
      { host: 'ccaf.io', kept: 3, rejected: 0, walled: 0 },
      { host: 'iea.org', kept: 0, rejected: 1, walled: 2 },
    ]);
    const { recallDomains } = await import('@/lib/knowledge/recall');
    const r = await recallDomains(brief());
    expect(r.count).toBe(3);
    expect(r.block).toContain('What worked before for topics like these:');
    expect(r.block.indexOf('sqlite.org')).toBeLessThan(r.block.indexOf('ccaf.io'));
    expect(r.block).toMatch(/Avoid, they did not read last time:[\s\S]*iea\.org/);
    expect(graph.queries[0].params).toMatchObject({ topics: expect.arrayContaining(['sqlite runs everything']) });
  });

  it('is empty when nothing is known, and empty when the store is down', async () => {
    const { recallDomains } = await import('@/lib/knowledge/recall');
    expect(await recallDomains(brief())).toEqual({ block: '', count: 0 });
    graph.query = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await recallDomains(brief())).toEqual({ block: '', count: 0 });
  });

  it('never exceeds the block cap however many domains there are', async () => {
    graph.answer(
      /Domain/,
      Array.from({ length: 200 }, (_, i) => ({ host: `host-${i}.example.com`, kept: 200 - i, rejected: 0, walled: 0 }))
    );
    const { recallDomains, MAX_BLOCK_CHARS } = await import('@/lib/knowledge/recall');
    const r = await recallDomains(brief());
    expect(r.block.length).toBeLessThanOrEqual(MAX_BLOCK_CHARS);
    expect(r.count).toBeLessThanOrEqual(18);
  });
});

describe('recallVerdicts', () => {
  it('tells the critic what happened to a url last time', async () => {
    graph.answer(/HUNTED/, [
      { url: 'https://sqlite.org/hirely.html', verdict: 'reject', reason: 'sales page', reelSlug: 'sqlite-runs-everything', at: '2026-09-01' },
    ]);
    const { recallVerdicts } = await import('@/lib/knowledge/recall');
    const r = await recallVerdicts(['https://sqlite.org/hirely.html', 'https://new.example']);
    expect(r.count).toBe(1);
    expect(r.block).toContain('https://sqlite.org/hirely.html: rejected on 2026-09-01 in sqlite-runs-everything (sales page)');
  });
});

describe('recallClaims', () => {
  it('finds proven claims near each mustProve and marks whether their source is in this reel', async () => {
    await vectors.ensure('claims', embed.dims);
    await vectors.upsert('claims', [
      {
        id: 'c1',
        vector: await embed.query('SQLite ships in every major phone OS and browser'),
        payload: { space: 'shared', key: 'k', text: 'SQLite ships in every phone OS', reelSlug: 'old', supportedBy: ['https://sqlite.org/mostdeployed.html'] },
      },
    ]);
    graph.answer(/SUPPORTED_BY/, [
      { claim: 'SQLite ships in every phone OS', url: 'https://sqlite.org/mostdeployed.html', passage: 'SQLite is built into every Android and iOS device.', figure: '' },
    ]);
    const { recallClaims } = await import('@/lib/knowledge/recall');
    const inSet = await recallClaims(brief(), ['https://sqlite.org/mostdeployed.html']);
    expect(inSet.block).toContain('citable: https://sqlite.org/mostdeployed.html');
    expect(inSet.block).toContain('built into every Android');
    const outOfSet = await recallClaims(brief(), []);
    expect(outOfSet.block).toContain('already proven elsewhere, hunt this source if you want it');
  });
});

describe('recallPassages', () => {
  it('returns the nearest chunks scoped to the kept candidates', async () => {
    await vectors.ensure('passages', embed.dims);
    await vectors.upsert('passages', [
      {
        id: 'a',
        vector: await embed.query('test suite 590 times'),
        payload: { space: 'reels', candidateId: 'kept1', text: 'The test suite is 590 times larger than the library.', sourceUrl: 'https://sqlite.org/testing.html' },
      },
      {
        id: 'b',
        vector: await embed.query('test suite 590 times'),
        payload: { space: 'reels', candidateId: 'other', text: 'Not this reel.', sourceUrl: 'https://x' },
      },
    ]);
    const { recallPassages } = await import('@/lib/knowledge/recall');
    const r = await recallPassages(
      { id: 'l2', order: 1, role: 'body', text: 'The test suite is 590 times larger.', citations: ['kept1'], assetIds: [], note: null, commentary: false },
      ['kept1']
    );
    expect(r.count).toBe(1);
    expect(r.block).toContain('590 times larger than the library');
    expect(r.block).not.toContain('Not this reel');
  });
});

describe('storeCounts', () => {
  it('reads one count from the graph and two from qdrant', async () => {
    graph.answer(/count\(n\)/, [{ n: 42 }]);
    await vectors.ensure('passages', 8);
    await vectors.ensure('claims', 8);
    const { storeCounts } = await import('@/lib/knowledge/recall');
    expect(await storeCounts()).toEqual({ nodes: 42, passages: 0, claims: 0 });
  });
});
