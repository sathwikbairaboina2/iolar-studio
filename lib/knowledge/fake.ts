// In-memory stand-ins with the exact surface of neo4j.ts, qdrant.ts and embed.ts.
// Every writer and reader is tested against these; the real stores are covered by the
// opt-in live test only.
import type { Embedder, Filter, GraphStore, Hit, NodeRef, Point, Props, Space, VectorStore } from './types';

const keyOf = (label: string, key: Props) =>
  `${label}|${Object.keys(key)
    .sort()
    .map((k) => `${k}=${String(key[k])}`)
    .join('&')}`;

export class FakeGraph implements GraphStore {
  nodes = new Map<string, { label: string; key: Props; props: Props }>();
  edges = new Map<string, { from: string; rel: string; to: string; props: Props }>();
  queries: { cypher: string; params: Record<string, unknown> }[] = [];
  private answers: { re: RegExp; rows: unknown[] }[] = [];

  node(label: string, key: Props) {
    return this.nodes.get(keyOf(label, key));
  }

  async mergeNode(label: string, key: Props, props: Props) {
    const id = keyOf(label, key);
    const prev = this.nodes.get(id);
    this.nodes.set(id, { label, key, props: { ...(prev?.props ?? {}), ...key, ...props } });
  }

  async mergeEdge(from: NodeRef, rel: string, to: NodeRef, props: Props = {}) {
    const f = keyOf(from.label, from.key);
    const t = keyOf(to.label, to.key);
    for (const [id, ref] of [
      [f, from],
      [t, to],
    ] as const) {
      if (!this.nodes.has(id)) this.nodes.set(id, { label: ref.label, key: ref.key, props: { ...ref.key } });
    }
    const id = `${f}-[${rel}]->${t}`;
    const prev = this.edges.get(id);
    this.edges.set(id, { from: f, rel, to: t, props: { ...(prev?.props ?? {}), ...props } });
  }

  answer(re: RegExp, rows: unknown[]) {
    this.answers.push({ re, rows });
  }

  async query<T = Record<string, unknown>>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
    this.queries.push({ cypher, params });
    const hit = this.answers.find((a) => a.re.test(cypher));
    return (hit?.rows ?? []) as T[];
  }

  async wipe(space: Space) {
    for (const [id, n] of this.nodes) if (n.props.space === space) this.nodes.delete(id);
    for (const [id, e] of this.edges) if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) this.edges.delete(id);
  }

  async close() {}
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

const matches = (payload: Record<string, unknown>, filter?: Filter) =>
  !filter ||
  Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(payload[k] as string) : payload[k] === v));

export class FakeVectors implements VectorStore {
  collections = new Map<string, { dims: number; points: Map<string, Point> }>();

  async ensure(collection: string, dims: number) {
    if (!this.collections.has(collection)) this.collections.set(collection, { dims, points: new Map() });
  }
  async upsert(collection: string, points: Point[]) {
    const c = this.collections.get(collection);
    if (!c) throw new Error(`no collection ${collection}`);
    for (const p of points) c.points.set(p.id, p);
  }
  async search(collection: string, vector: number[], opts: { limit: number; filter?: Filter }): Promise<Hit[]> {
    const c = this.collections.get(collection);
    if (!c) return [];
    return [...c.points.values()]
      .filter((p) => matches(p.payload, opts.filter))
      .map((p) => ({ id: p.id, score: cosine(vector, p.vector), payload: p.payload }))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit);
  }
  async deleteWhere(collection: string, filter: Filter) {
    const c = this.collections.get(collection);
    if (!c) return;
    for (const [id, p] of c.points) if (matches(p.payload, filter)) c.points.delete(id);
  }
  async count(collection: string) {
    return this.collections.get(collection)?.points.size ?? 0;
  }
}

/** A hash of the text spread over `dims` numbers. Same text, same vector; no network. */
export class FakeEmbed implements Embedder {
  constructor(public dims = 8) {}
  private one(text: string): number[] {
    const v = new Array<number>(this.dims).fill(0);
    for (let i = 0; i < text.length; i++) v[i % this.dims] += text.charCodeAt(i) / 255;
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / n);
  }
  async docs(texts: string[]) {
    return texts.map((t) => this.one(t));
  }
  async query(text: string) {
    return this.one(text);
  }
}
