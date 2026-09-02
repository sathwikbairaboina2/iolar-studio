import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';

let graph: FakeGraph;
let vectors: FakeVectors;
beforeEach(() => {
  graph = new FakeGraph();
  vectors = new FakeVectors();
  useStoresForTests({ graph, vectors, embed: new FakeEmbed() });
});

describe('the graph view', () => {
  it('asks for one space, capped, most connected first, and shapes it for the renderer', async () => {
    graph.answer(/WHERE n\.space = \$space OR n\.space = 'shared'/, [
      { id: 'Reel:x', label: 'X', kind: 'Reel', space: 'reels', degree: 3 },
      { id: 'Topic:sqlite', label: 'SQLite', kind: 'Topic', space: 'shared', degree: 2 },
    ]);
    graph.answer(/AS source, .*AS target, type\(r\) AS rel/, [{ source: 'Reel:x', target: 'Topic:sqlite', rel: 'ABOUT' }]);
    const { spaceGraph } = await import('@/lib/knowledge/view');
    const g = await spaceGraph('reels', 50);
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toEqual([{ source: 'Reel:x', target: 'Topic:sqlite', rel: 'ABOUT' }]);
    expect(graph.queries[0].params).toMatchObject({ space: 'reels', limit: 50 });
  });

  it('cross links are nodes whose neighbours carry more than one space', async () => {
    graph.answer(/size\(spaces\) > 1/, [{ id: 'Topic:sqlite', label: 'SQLite', kind: 'Topic', space: 'shared', degree: 4 }]);
    graph.answer(/AS source, .*AS target, type\(r\) AS rel/, []);
    const { crossLinks } = await import('@/lib/knowledge/view');
    const g = await crossLinks();
    expect(g.nodes[0].id).toBe('Topic:sqlite');
  });

  it("meaning search embeds the query and searches the space's collections", async () => {
    await vectors.ensure('passages', 8);
    const e = new FakeEmbed();
    await vectors.upsert('passages', [
      {
        id: 'p1',
        vector: await e.query('sqlite test suite'),
        payload: { space: 'reels', text: 'The test suite is 590 times larger.', reelSlug: 'x' },
      },
    ]);
    const { meaningSearch } = await import('@/lib/knowledge/view');
    const hits = await meaningSearch('reels', 'sqlite test suite');
    expect(hits[0]).toMatchObject({ collection: 'passages', text: 'The test suite is 590 times larger.' });
  });
});
