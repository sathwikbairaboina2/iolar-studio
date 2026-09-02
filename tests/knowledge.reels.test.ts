import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';
import { parseBrief } from '@/lib/reel/research/brief';
import type { Candidate } from '@/lib/reel/research/candidate';

const brief = () =>
  parseBrief({
    runId: 'sqlite-runs-everything',
    createdAt: '2026-09-02T01:20:00.000Z',
    topic: 'SQLite runs everything',
    angle: 'x',
    audience: 'developers',
    videoFormat: 'reel',
    mustProve: ['SQLite ships in every major phone OS and browser', 'its test suite is orders of magnitude larger than the library'],
    mustInclude: [],
    avoid: [],
    recencyWindowDays: 365,
    sourceClasses: ['docs'],
    searchQueries: [{ class: 'docs', queries: ['sqlite'] }],
    referenceReel: null,
    status: 'briefed',
  });

const cand = (over: Partial<Candidate>): Candidate =>
  ({
    id: 'fa3ebbf3c822',
    url: 'https://sqlite.org/mostdeployed.html',
    canonicalUrl: 'https://sqlite.org/mostdeployed.html',
    title: 'Most deployed',
    publisher: 'sqlite.org',
    author: null,
    publishedAt: null,
    retrievedAt: '2026-09-02T00:00:00.000Z',
    thumbnailUrl: null,
    durationSec: null,
    summary: 's',
    pullQuotes: [],
    stats: [],
    assetKind: 'doc',
    whyItMatters: 'w',
    scoreTotal: 80,
    verdict: 'keep',
    rejectReason: null,
    dupeOf: null,
    hunterAgent: 'local',
    ...over,
  }) as Candidate;

let graph: FakeGraph;
let vectors: FakeVectors;
beforeEach(() => {
  graph = new FakeGraph();
  vectors = new FakeVectors();
  useStoresForTests({ graph, vectors, embed: new FakeEmbed() });
});

describe('the reels space', () => {
  it('records a brief as a reel about topics that must prove claims', async () => {
    const { recordBrief } = await import('@/lib/knowledge/spaces/reels');
    await recordBrief('sqlite-runs-everything', brief());
    expect(graph.node('Reel', { slug: 'sqlite-runs-everything' })?.props).toMatchObject({
      space: 'reels',
      title: 'SQLite runs everything',
    });
    const rels = [...graph.edges.values()].map((e) => e.rel);
    expect(rels).toContain('ABOUT');
    expect(rels.filter((r) => r === 'MUST_PROVE').length).toBe(2);
    const claim = [...graph.nodes.values()].find((n) => n.label === 'Claim');
    expect(claim?.props.space).toBe('shared');
  });

  it('records the hunt as HUNTED edges with the verdict, and domains with counters', async () => {
    const { recordHunt } = await import('@/lib/knowledge/spaces/reels');
    await recordHunt('sqlite-runs-everything', {
      runId: 'sqlite-runs-everything',
      generatedAt: 'x',
      criticVersion: '1',
      stats: { perClass: {}, totalFound: 2, totalKept: 1, dupesCollapsed: 0 },
      candidates: [
        cand({}),
        cand({
          id: '4620a739908e',
          url: 'https://sqlite.org/hirely.html',
          canonicalUrl: 'https://sqlite.org/hirely.html',
          verdict: 'reject',
          rejectReason: 'sales page',
        }),
      ],
    } as never);
    const hunted = [...graph.edges.values()].filter((e) => e.rel === 'HUNTED');
    expect(hunted).toHaveLength(2);
    expect(hunted.find((e) => e.to.includes('hirely'))?.props).toMatchObject({ verdict: 'reject', reason: 'sales page' });
    expect(graph.node('Domain', { host: 'sqlite.org' })?.props.space).toBe('shared');
    expect([...graph.edges.values()].filter((e) => e.rel === 'ON')).toHaveLength(2);
  });

  it('records the review as KEPT and REJECTED, from the effective state', async () => {
    const { recordReview } = await import('@/lib/knowledge/spaces/reels');
    await recordReview(
      'sqlite-runs-everything',
      [
        cand({}),
        cand({
          id: '4620a739908e',
          url: 'https://sqlite.org/hirely.html',
          canonicalUrl: 'https://sqlite.org/hirely.html',
          verdict: 'maybe',
        }),
      ],
      {
        runId: 'sqlite-runs-everything',
        updatedAt: '2026-09-02T00:00:00.000Z',
        fetchRequestedAt: null,
        decisions: { '4620a739908e': { state: 'reject', starred: false, note: 'dup' } },
      }
    );
    const rels = [...graph.edges.values()].map((e) => e.rel);
    expect(rels.filter((r) => r === 'KEPT')).toHaveLength(1);
    expect(rels.filter((r) => r === 'REJECTED')).toHaveLength(1);
  });

  it('turns evidence into passages in qdrant, one point per chunk, stable ids', async () => {
    const { recordEvidence } = await import('@/lib/knowledge/spaces/reels');
    const text = Array.from({ length: 900 }, (_, i) => `Word${i}.`).join(' ');
    const ev = { candidateId: 'fa3ebbf3c822', kind: 'pagetext', retrievedAt: 'x', text, segments: null } as never;
    await recordEvidence('sqlite-runs-everything', cand({}), ev);
    const n = await vectors.count('passages');
    expect(n).toBeGreaterThan(1);
    await recordEvidence('sqlite-runs-everything', cand({}), ev);
    expect(await vectors.count('passages')).toBe(n);
    const hit = (await vectors.search('passages', await new FakeEmbed().query('Word3.'), { limit: 1 }))[0];
    expect(hit.payload).toMatchObject({
      space: 'reels',
      reelSlug: 'sqlite-runs-everything',
      host: 'sqlite.org',
      candidateId: 'fa3ebbf3c822',
    });
  });

  it('records script lines, citations, proofs, flags, and a SUPPORTED_BY only for clean lines', async () => {
    const { recordScript } = await import('@/lib/knowledge/spaces/reels');
    const script = {
      runId: 'sqlite-runs-everything',
      createdAt: 'x',
      updatedAt: 'x',
      status: 'draft',
      lines: [
        { id: 'l1', order: 0, role: 'hook', text: 'SQLite runs in every phone.', citations: ['fa3ebbf3c822'], assetIds: [], note: null, commentary: false },
        { id: 'l2', order: 1, role: 'body', text: 'The test suite is 590 times larger.', citations: ['fa3ebbf3c822'], assetIds: [], note: null, commentary: false },
      ],
      unsupported: [],
      coverage: [
        { claim: 'SQLite ships in every major phone OS and browser', lineIds: ['l1'], why: 'says so' },
        { claim: 'its test suite is orders of magnitude larger than the library', lineIds: ['l2'], why: 'says so' },
      ],
      flags: [{ lineId: 'l2', issue: 'source says 590 times as much test code, not larger' }],
    } as never;
    const evidence = {
      fa3ebbf3c822: {
        candidateId: 'fa3ebbf3c822',
        kind: 'pagetext',
        retrievedAt: 'x',
        text: 'SQLite runs in every phone. It has 590 times as much test code.',
        segments: null,
      },
    } as never;
    await recordScript('sqlite-runs-everything', script, [cand({})], evidence);
    const rels = [...graph.edges.values()];
    expect(rels.filter((e) => e.rel === 'CITES')).toHaveLength(2);
    expect(rels.filter((e) => e.rel === 'PROVES')).toHaveLength(2);
    expect(rels.filter((e) => e.rel === 'FLAGGED')).toHaveLength(1);
    const supported = rels.filter((e) => e.rel === 'SUPPORTED_BY');
    expect(supported).toHaveLength(1);
    expect(supported[0].props.passage).toContain('every phone');
    expect(await vectors.count('claims')).toBe(1);
  });
});
