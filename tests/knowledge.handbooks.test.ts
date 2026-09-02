import { describe, it, expect, beforeEach } from 'vitest';
import { validatePost, type Post } from '@/lib/schema';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';

const post = (series: string, headings: string[]): Post =>
  validatePost({
    brand: 'iolar',
    template: 'spiral-notes',
    ratio: '3:4',
    seed: 1,
    series,
    date: 'd',
    slides: [{ page_title: 'P', blocks: headings.map((h) => ({ type: 'heading', text: h })) }],
    caption: { text: '', hashtags: [] },
  });

let graph: FakeGraph;
beforeEach(() => {
  graph = new FakeGraph();
  useStoresForTests({ graph, vectors: new FakeVectors(), embed: new FakeEmbed() });
});

describe('the handbooks space', () => {
  it('links subject to chapter to topic, all in the handbooks space, topics shared', async () => {
    const { syncSubject, syncChapter } = await import('@/lib/knowledge/spaces/handbooks');
    await syncSubject({ slug: 'python', name: 'Python', emoji: '🐍', description: '' });
    await syncChapter('python', 'lists', post('LISTS', ['1. Slicing basics', 'Append is amortised O(1)']), 'draft');
    expect(graph.node('Subject', { slug: 'python' })?.props.space).toBe('handbooks');
    expect(graph.node('Chapter', { subject: 'python', slug: 'lists' })?.props).toMatchObject({
      space: 'handbooks',
      title: 'LISTS',
      status: 'draft',
    });
    expect(graph.node('Topic', { key: 'slicing basics' })?.props.space).toBe('shared');
    const rels = [...graph.edges.values()].map((e) => e.rel);
    expect(rels).toContain('HAS_CHAPTER');
    expect(rels.filter((r) => r === 'COVERS').length).toBe(2);
  });

  it('is idempotent: the same chapter twice is one chapter and one edge set', async () => {
    const { syncSubject, syncChapter } = await import('@/lib/knowledge/spaces/handbooks');
    await syncSubject({ slug: 'python', name: 'Python', emoji: '', description: '' });
    await syncChapter('python', 'lists', post('LISTS', ['Slicing']), 'draft');
    const n = graph.nodes.size,
      e = graph.edges.size;
    await syncChapter('python', 'lists', post('LISTS', ['Slicing']), 'rendered');
    expect(graph.nodes.size).toBe(n);
    expect(graph.edges.size).toBe(e);
    expect(graph.node('Chapter', { subject: 'python', slug: 'lists' })?.props.status).toBe('rendered');
  });

  it('reads chapter context through cypher, with the chapter as a parameter', async () => {
    const { chapterContext } = await import('@/lib/knowledge/spaces/handbooks');
    graph.answer(/OPTIONAL MATCH \(t\)<-\[cov:COVERS\]/, [{ id: 'topic:slicing', label: 'Slicing', weight: 2 }]);
    graph.answer(/<-\[:COVERS\]-\(o:Chapter\)/, [{ subject: 'python', chapter: 'strings', title: 'STRINGS', shared: 1 }]);
    const ctx = await chapterContext('python', 'lists');
    expect(ctx.topics[0].label).toBe('Slicing');
    expect(ctx.related[0].chapter).toBe('strings');
    expect(graph.queries[0].params).toMatchObject({ subject: 'python', chapter: 'lists' });
  });

  it('never throws out of a writer when the store is down', async () => {
    const broken = new FakeGraph();
    broken.mergeNode = async () => {
      throw new Error('ECONNREFUSED');
    };
    useStoresForTests({ graph: broken, vectors: new FakeVectors(), embed: new FakeEmbed() });
    const { syncSubject } = await import('@/lib/knowledge/spaces/handbooks');
    await expect(syncSubject({ slug: 'x', name: 'X', emoji: '', description: '' })).resolves.toBeUndefined();
  });
});
