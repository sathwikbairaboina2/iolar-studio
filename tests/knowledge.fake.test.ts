import { describe, it, expect } from 'vitest';

describe('ids', () => {
  it('makes a stable uuid-shaped point id from space, kind and key', async () => {
    const { pointId, claimId, hostOf } = await import('@/lib/knowledge/ids');
    const a = pointId('reels', 'passage', 'https://sqlite.org/about.html#3');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(pointId('reels', 'passage', 'https://sqlite.org/about.html#3')).toBe(a);
    expect(pointId('reels', 'claim', 'https://sqlite.org/about.html#3')).not.toBe(a);
    expect(claimId('SQLite ships in every phone')).toBe(claimId('sqlite ships in every phone.'));
    expect(hostOf('https://www.Sqlite.org/about.html')).toBe('sqlite.org');
  });
});

describe('topics', () => {
  it('kept the old normalisation', async () => {
    const { topicFromPoint, topicKey } = await import('@/lib/knowledge/topics');
    expect(topicFromPoint('Slicing: lst[1:4] returns a copy')).toBe('slicing');
    expect(topicKey('The SQLite `library` and its Tests')).toBe('sqlite tests');
  });
});

describe('the fake graph', () => {
  it('merges a node once however many times it is written', async () => {
    const { FakeGraph } = await import('@/lib/knowledge/fake');
    const g = new FakeGraph();
    await g.mergeNode('Topic', { key: 'sqlite' }, { space: 'shared', label: 'SQLite' });
    await g.mergeNode('Topic', { key: 'sqlite' }, { space: 'shared', label: 'SQLite', weight: 2 });
    expect(g.nodes.size).toBe(1);
    expect(g.node('Topic', { key: 'sqlite' })?.props.weight).toBe(2);
  });

  it('merges an edge once and keeps its latest props', async () => {
    const { FakeGraph } = await import('@/lib/knowledge/fake');
    const g = new FakeGraph();
    const reel = { label: 'Reel', key: { slug: 'x' } };
    const src = { label: 'Source', key: { url: 'https://a' } };
    await g.mergeEdge(reel, 'HUNTED', src, { verdict: 'maybe' });
    await g.mergeEdge(reel, 'HUNTED', src, { verdict: 'keep' });
    expect(g.edges.size).toBe(1);
    expect([...g.edges.values()][0].props.verdict).toBe('keep');
  });

  it('answers queries by pattern and records them', async () => {
    const { FakeGraph } = await import('@/lib/knowledge/fake');
    const g = new FakeGraph();
    g.answer(/MATCH \(d:Domain\)/, [{ host: 'sqlite.org', kept: 3 }]);
    const rows = await g.query('MATCH (d:Domain) RETURN d.host AS host, d.kept AS kept', { topics: ['sqlite'] });
    expect(rows).toEqual([{ host: 'sqlite.org', kept: 3 }]);
    expect(g.queries[0].params).toEqual({ topics: ['sqlite'] });
  });

  it('wipes one space and leaves the rest', async () => {
    const { FakeGraph } = await import('@/lib/knowledge/fake');
    const g = new FakeGraph();
    await g.mergeNode('Reel', { slug: 'x' }, { space: 'reels' });
    await g.mergeNode('Chapter', { subject: 's', slug: 'c' }, { space: 'handbooks' });
    await g.wipe('reels');
    expect(g.nodes.size).toBe(1);
  });
});

describe('the fake vectors', () => {
  it('upserts by id and searches by cosine with a payload filter', async () => {
    const { FakeVectors } = await import('@/lib/knowledge/fake');
    const v = new FakeVectors();
    await v.ensure('passages', 3);
    await v.upsert('passages', [
      { id: 'a', vector: [1, 0, 0], payload: { space: 'reels', reelSlug: 'x' } },
      { id: 'b', vector: [0, 1, 0], payload: { space: 'reels', reelSlug: 'y' } },
      { id: 'a', vector: [0.9, 0.1, 0], payload: { space: 'reels', reelSlug: 'x' } },
    ]);
    expect(await v.count('passages')).toBe(2);
    const hits = await v.search('passages', [1, 0, 0], { limit: 5, filter: { reelSlug: 'x' } });
    expect(hits.map((h) => h.id)).toEqual(['a']);
    expect(hits[0].score).toBeGreaterThan(0.9);
  });
});

describe('the fake embedder', () => {
  it('is deterministic and prefixes nothing, so tests can reason about vectors', async () => {
    const { FakeEmbed } = await import('@/lib/knowledge/fake');
    const e = new FakeEmbed(4);
    const [a] = await e.docs(['hello']);
    const b = await e.query('hello');
    expect(a).toEqual(b);
    expect(a.length).toBe(4);
  });
});
