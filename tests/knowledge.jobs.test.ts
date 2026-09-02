import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';

let graph: FakeGraph;
beforeEach(() => {
  graph = new FakeGraph();
  useStoresForTests({ graph, vectors: new FakeVectors(), embed: new FakeEmbed() });
});

const job = (over: Record<string, unknown>) => ({
  id: '1',
  role: 'SRE',
  company: 'Acme',
  function: 'engineering',
  location: 'Bengaluru',
  workMode: 'remote',
  experienceMin: 2,
  experienceMax: 5,
  salaryMin: null,
  salaryMax: null,
  currency: 'INR',
  link: 'https://a',
  ...over,
});

const view = {
  week: '2026-W46',
  stage: 'exported',
  hasExport: true,
  hasVoice: true,
  summary: null,
  reel: { style: 'feed', world: 'feed-native', highlights: [{ highlight: 'salary-spread', scene: 'stat-bars', score: 0.6 }] },
  jobs: {
    week: '2026-W46',
    importedAt: 'x',
    source: { kind: 'sheet', url: 'u' },
    rejected: [],
    warnings: [],
    jobs: [
      job({}),
      job({ id: '2', role: 'SRE 2', location: 'Pune', workMode: 'onsite', link: 'https://b' }),
      job({ id: '3', role: 'PM', company: 'Globex', function: 'product', location: 'Pune', workMode: 'hybrid', link: 'https://c' }),
    ],
  },
};

describe('the jobs space', () => {
  it('records a week with employers, functions, cities, modes and highlights, counted', async () => {
    const { recordWeek } = await import('@/lib/knowledge/spaces/jobs');
    await recordWeek(view as never);
    expect(graph.node('Week', { week: '2026-W46' })?.props).toMatchObject({
      space: 'jobs',
      stage: 'exported',
      counted: 3,
      style: 'feed',
      world: 'feed-native',
    });
    const edges = [...graph.edges.values()];
    const lists = edges.filter((e) => e.rel === 'LISTS');
    expect(lists).toHaveLength(2);
    expect(lists.find((e) => e.to.includes('Acme'))?.props.count).toBe(2);
    expect(edges.filter((e) => e.rel === 'IN' && e.to.startsWith('Function')).length).toBe(2);
    expect(edges.filter((e) => e.rel === 'IN' && e.to.startsWith('City')).length).toBe(2);
    expect(edges.find((e) => e.rel === 'MODE' && e.to.includes('remote'))?.props.count).toBe(1);
    expect(edges.find((e) => e.rel === 'HIGHLIGHT')?.props).toMatchObject({ score: 0.6, scene: 'stat-bars' });
    expect(graph.node('Employer', { name: 'Acme' })?.props.space).toBe('jobs');
  });

  it('is idempotent', async () => {
    const { recordWeek } = await import('@/lib/knowledge/spaces/jobs');
    await recordWeek(view as never);
    const n = graph.nodes.size,
      e = graph.edges.size;
    await recordWeek(view as never);
    expect([graph.nodes.size, graph.edges.size]).toEqual([n, e]);
  });

  it('reports the stage it last indexed a week at', async () => {
    const { indexedStage } = await import('@/lib/knowledge/spaces/jobs');
    graph.answer(/MATCH \(w:Week \{week: \$week\}\)/, [{ stage: 'planned' }]);
    expect(await indexedStage('2026-W46')).toBe('planned');
  });
});
