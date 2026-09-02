import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => vi.resetModules());

describe('chunking', () => {
  it('splits on sentence ends near the token budget and never returns an empty chunk', async () => {
    const { chunkText } = await import('@/lib/knowledge/chunk');
    const text = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} says something about SQLite tests.`).join(' ');
    const chunks = chunkText(text, 60);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.trim().length).toBeGreaterThan(0);
      expect(c.split(/\s+/).length).toBeLessThanOrEqual(80);
    }
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text);
  });
});

describe('the ollama embedder', () => {
  it('prefixes documents and queries the way nomic expects, in batches', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url, body });
      const n = (body.input as string[]).length;
      return { ok: true, status: 200, json: async () => ({ embeddings: Array.from({ length: n }, () => [0.1, 0.2, 0.3]) }) } as Response;
    });
    const { OllamaEmbed } = await import('@/lib/knowledge/embed');
    const e = new OllamaEmbed({ baseUrl: 'http://127.0.0.1:25103', model: 'nomic-embed-text', dims: 3, batch: 2 });
    const out = await e.docs(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('http://127.0.0.1:25103/api/embed');
    expect(calls[0].body.input).toEqual(['search_document: a', 'search_document: b']);
    await e.query('q');
    expect(calls[2].body.input).toEqual(['search_query: q']);
  });

  it('caches by text so a reindex does not re-embed what it already embedded', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      n++;
      const k = (JSON.parse(String(init?.body)).input as string[]).length;
      return { ok: true, status: 200, json: async () => ({ embeddings: Array.from({ length: k }, () => [1, 0, 0]) }) } as Response;
    });
    const { OllamaEmbed } = await import('@/lib/knowledge/embed');
    const e = new OllamaEmbed({ baseUrl: 'http://x', model: 'm', dims: 3 });
    await e.docs(['same']);
    await e.docs(['same']);
    expect(n).toBe(1);
  });
});

describe('the store singleton', () => {
  it('hands tests the fake and everyone else the real thing', async () => {
    const { useStoresForTests, getStores } = await import('@/lib/knowledge/stores');
    const { FakeGraph, FakeVectors, FakeEmbed } = await import('@/lib/knowledge/fake');
    const fake = { graph: new FakeGraph(), vectors: new FakeVectors(), embed: new FakeEmbed() };
    useStoresForTests(fake);
    expect(getStores()).toBe(fake);
    useStoresForTests(null);
  });
});
