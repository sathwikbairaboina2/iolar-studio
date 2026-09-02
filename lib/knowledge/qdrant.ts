import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';
import type { Filter, Hit, Point, VectorStore } from './types';

const toQdrantFilter = (f: Filter): Schemas['Filter'] => ({
  must: Object.entries(f).map(([k, v]) =>
    Array.isArray(v) ? { key: k, match: { any: v } } : { key: k, match: { value: v } }
  ),
});

export class QdrantVectors implements VectorStore {
  private c: QdrantClient;
  private known = new Set<string>();
  constructor(url: string) {
    this.c = new QdrantClient({ url });
  }

  async ensure(collection: string, dims: number) {
    if (this.known.has(collection)) return;
    const { exists } = await this.c.collectionExists(collection);
    if (!exists) await this.c.createCollection(collection, { vectors: { size: dims, distance: 'Cosine' } });
    this.known.add(collection);
  }
  async upsert(collection: string, points: Point[]) {
    if (!points.length) return;
    await this.c.upsert(collection, { wait: true, points });
  }
  async search(collection: string, vector: number[], opts: { limit: number; filter?: Filter }): Promise<Hit[]> {
    // Client 1.19 folded search into query; the shape of a hit is the same.
    const res = await this.c.query(collection, {
      query: vector,
      limit: opts.limit,
      filter: opts.filter ? toQdrantFilter(opts.filter) : undefined,
      with_payload: true,
    });
    return res.points.map((r) => ({ id: String(r.id), score: r.score, payload: (r.payload ?? {}) as Record<string, unknown> }));
  }
  async deleteWhere(collection: string, filter: Filter) {
    await this.c.delete(collection, { wait: true, filter: toQdrantFilter(filter) });
  }
  async count(collection: string) {
    const { count } = await this.c.count(collection, { exact: true });
    return count;
  }
}
