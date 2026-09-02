# Knowledge Layer, Part 1: Stores, Spaces, Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SQLite knowledge graph with Neo4j (one graph, one `space` per category) and Qdrant (passages, claims), written through a single `lib/knowledge/` module, rebuildable from disk, and shown on a tabbed graph page.

**Architecture:** A `GraphStore` and a `VectorStore` interface with a real implementation (neo4j-driver, @qdrant/js-client-rest) and an in-memory fake used by every unit test. Three space writers (handbooks, reels, jobs) call only `mergeNode` / `mergeEdge` / `upsert`, which makes every write idempotent and `reindex` safe. Readers run Cypher through `query`. Docker compose owns the two stores, volumes on `D:`.

**Tech Stack:** Next 16.3.3 (App Router, route params are Promises), TypeScript, zod 4, vitest 4, node:sqlite, neo4j-driver 5, @qdrant/js-client-rest 1, cytoscape 3 + cytoscape-fcose, Ollama embeddings (`nomic-embed-text`, 768 dims), Docker Desktop.

**Spec:** `docs/superpowers/specs/2026-09-02-knowledge-graph-neo4j-design.md`

**Companion plan:** `docs/superpowers/plans/2026-09-02-knowledge-layer-agent-memory.md` (phase 1 recall for the research agents; depends on this plan).

## Global Constraints

- Nothing leaves the machine. Neo4j, Qdrant and the embedding model run locally; no cloud endpoint is ever called.
- Ports: Neo4j bolt `3124`, Neo4j browser `3125`, Qdrant http `3126`, Qdrant grpc `3127`, all bound to `127.0.0.1`.
- Volumes: `D:\iolar\neo4j\data`, `D:\iolar\neo4j\logs`, `D:\iolar\qdrant\storage`.
- Images: `neo4j:5.26-community`, `qdrant/qdrant:v1.13.4`.
- Embeddings: `nomic-embed-text`, 768 dimensions, cosine, prefix `search_document: ` on write and `search_query: ` on read.
- Every node carries `space` ∈ `handbooks | reels | jobs | shared`.
- Writers use `MERGE`, never `CREATE`. Every vector point id is deterministic: `pointId(space, kind, key)`.
- A writer never throws to its caller: it catches, logs one line via `logPlugin('knowledge', …)`, and returns.
- Files on disk stay the truth. `scripts/reindex-knowledge.mts --wipe` must rebuild both stores from `data/`.
- SQLite keeps `subjects`, `chapters`, `parts`, `books`, `refs`, `renders`. Only `nodes` and `edges` are dropped.
- The studio runs with `npx next dev --webpack -p 3120`. Tests run with `npx vitest run`. Typecheck with `npx tsc --noEmit -p .`. Lint with `npx eslint <paths>`.
- Commit after every task. Commit messages: lowercase, `feat:` / `fix:` / `test:` / `chore:`, one sentence, end with the two attribution lines already in use in this repo (`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and the `Claude-Session:` line).

---

## File structure

| File | Responsibility |
|---|---|
| `docker/compose.yml` | The two stores, ports, volumes on D:, heap cap |
| `docker/.env.example` | The one secret the compose reads, documented |
| `scripts/knowledge-env.mts` | Writes `docker/.env` from `data/settings.json` so the two cannot drift |
| `lib/settings.ts` | Seven new keys with defaults |
| `lib/knowledge/types.ts` | `GraphStore`, `VectorStore`, `Space`, `NodeRef`, `Point`, `Hit` |
| `lib/knowledge/ids.ts` | `pointId`, `nodeKey`, `claimId`, `hostOf` |
| `lib/knowledge/topics.ts` | `topicKey`, `topicFromPoint` (moved from `lib/graph.ts`, unchanged) |
| `lib/knowledge/fake.ts` | In-memory `FakeGraph`, `FakeVectors`, `FakeEmbed` for tests |
| `lib/knowledge/neo4j.ts` | `Neo4jGraph implements GraphStore` over neo4j-driver |
| `lib/knowledge/qdrant.ts` | `QdrantVectors implements VectorStore` over the REST client |
| `lib/knowledge/embed.ts` | `Embedder` over Ollama `/api/embed`, batched, hashed cache |
| `lib/knowledge/stores.ts` | `getStores()` singleton from settings; `useStoresForTests()` |
| `lib/knowledge/chunk.ts` | `chunkText(text, tokens)` for passages |
| `lib/knowledge/spaces/handbooks.ts` | Subject/Chapter/Topic writers and the three readers `lib/graph.ts` had |
| `lib/knowledge/spaces/reels.ts` | `recordBrief`, `recordHunt`, `recordReview`, `recordEvidence`, `recordScript` |
| `lib/knowledge/spaces/jobs.ts` | `recordWeek` from a board week view |
| `lib/knowledge/view.ts` | `spaceGraph`, `crossLinks`, `labelSearch`, `meaningSearch` for the page |
| `lib/knowledge/index.ts` | Public surface, `knowledgeEnabled()` |
| `lib/plugins/registry.ts`, `lib/plugins/health.ts` | `neo4j` and `qdrant` cards |
| `lib/plugins/start.ts` | Unchanged; the recipe is `docker compose … up -d <service>` |
| `lib/db.ts` | Drop `nodes`, `edges` at open; remove them from `SCHEMA` |
| `lib/store.ts` | `indexChapter` calls the handbooks space |
| `lib/reel/research/store.ts` | Five `write*` functions call the reels space |
| `lib/reel/research/gatherRun.ts` | Page cap 200,000; passages recorded after gather |
| `app/api/jobs/weeks/route.ts` | Records each week view once per stage |
| `app/api/graph/route.ts` | `?space=` `?q=` `?ask=` over `view.ts` |
| `app/graph/page.tsx` | Tabs, cytoscape, two search boxes |
| `scripts/reindex-knowledge.mts` | Replays `data/` and the board through the writers |
| Tests | `tests/knowledge.*.test.ts`, `tests/graph.test.ts` rewritten, `tests/plugins.health.test.ts` extended |

---

### Task 1: Settings, compose, and the env writer

**Files:**
- Create: `docker/compose.yml`, `docker/.env.example`, `scripts/knowledge-env.mts`
- Modify: `lib/settings.ts` (type at lines 4–44, defaults at 46–83), `.gitignore`
- Test: `tests/knowledge.settings.test.ts`

**Interfaces:**
- Produces: `Settings.neo4jUrl`, `neo4jUser`, `neo4jPassword`, `qdrantUrl`, `embedOllamaUrl`, `embedModel`, `knowledgeMemory`; `scripts/knowledge-env.mts` writes `docker/.env` with `NEO4J_PASSWORD=<settings.neo4jPassword>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/knowledge.settings.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-know-'));
});

describe('knowledge settings', () => {
  it('has local defaults for both stores and the embedder', async () => {
    const { getSettings } = await import('@/lib/settings');
    const s = getSettings();
    expect(s.neo4jUrl).toBe('bolt://127.0.0.1:3124');
    expect(s.neo4jUser).toBe('neo4j');
    expect(s.neo4jPassword).toBe('iolar-local');
    expect(s.qdrantUrl).toBe('http://127.0.0.1:3126');
    expect(s.embedOllamaUrl).toBe('http://127.0.0.1:25103');
    expect(s.embedModel).toBe('nomic-embed-text');
    expect(s.knowledgeMemory).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/knowledge.settings.test.ts`
Expected: FAIL, `expected undefined to be 'bolt://127.0.0.1:3124'`.

- [ ] **Step 3: Add the keys**

In `lib/settings.ts`, after `researchModel: string;` in the type:

```ts
  /** The knowledge graph. bolt, not http; the browser UI is on the next port. */
  neo4jUrl: string;
  neo4jUser: string;
  neo4jPassword: string;
  /** Passages and claims, for the agents' memory. */
  qdrantUrl: string;
  /** The ollama that embeds. research-ollama by default: it already holds nomic-embed-text. */
  embedOllamaUrl: string;
  embedModel: string;
  /** Off restores the pipeline exactly as it was before the knowledge layer. */
  knowledgeMemory: boolean;
```

After `researchModel: 'qwen3.8:27b',` in `DEFAULTS`:

```ts
  neo4jUrl: 'bolt://127.0.0.1:3124',
  neo4jUser: 'neo4j',
  neo4jPassword: 'iolar-local',
  qdrantUrl: 'http://127.0.0.1:3126',
  embedOllamaUrl: 'http://127.0.0.1:25103',
  embedModel: 'nomic-embed-text',
  knowledgeMemory: true,
```

- [ ] **Step 4: Run it, expect pass**

Run: `npx vitest run tests/knowledge.settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the compose file**

```yaml
# docker/compose.yml
# The knowledge layer. Both stores are derived from data/ and can be wiped and rebuilt
# with scripts/reindex-knowledge.mts --wipe. Volumes live on D: because passages grow
# with every reel and the system drive does not.
services:
  iolar-neo4j:
    image: neo4j:5.26-community
    container_name: iolar-neo4j
    ports:
      - "127.0.0.1:3124:7687"
      - "127.0.0.1:3125:7474"
    environment:
      NEO4J_AUTH: "neo4j/${NEO4J_PASSWORD:-iolar-local}"
      NEO4J_server_memory_heap_max__size: 1G
      NEO4J_server_memory_pagecache_size: 512M
    volumes:
      - "D:/iolar/neo4j/data:/data"
      - "D:/iolar/neo4j/logs:/logs"
    restart: unless-stopped

  iolar-qdrant:
    image: qdrant/qdrant:v1.13.4
    container_name: iolar-qdrant
    ports:
      - "127.0.0.1:3126:6333"
      - "127.0.0.1:3127:6334"
    volumes:
      - "D:/iolar/qdrant/storage:/qdrant/storage"
    restart: unless-stopped
```

```
# docker/.env.example
# Copied to docker/.env by `npx tsx scripts/knowledge-env.mts`, from data/settings.json.
NEO4J_PASSWORD=iolar-local
```

Add `docker/.env` to `.gitignore`.

- [ ] **Step 6: Write the env writer**

```ts
// scripts/knowledge-env.mts
// Writes docker/.env from data/settings.json so compose and the studio never disagree
// about the Neo4j password. Run before the first `docker compose up`.
import { writeFileSync } from 'fs';
import path from 'path';
import { getSettings } from '../lib/settings';

const s = getSettings();
const out = path.join(process.cwd(), 'docker', '.env');
writeFileSync(out, `NEO4J_PASSWORD=${s.neo4jPassword}\n`);
console.log(`wrote ${out}`);
```

- [ ] **Step 7: Bring the stores up once and confirm**

Run: `npx tsx scripts/knowledge-env.mts && docker compose -f docker/compose.yml up -d`
Then: `curl -s http://127.0.0.1:3126/healthz` → `healthz check passed`; `curl -s -o NUL -w "%{http_code}" http://127.0.0.1:3125/` → `200`.
Check `D:\iolar\neo4j\data` and `D:\iolar\qdrant\storage` exist.

- [ ] **Step 8: Commit**

```bash
git add lib/settings.ts docker/compose.yml docker/.env.example scripts/knowledge-env.mts .gitignore tests/knowledge.settings.test.ts
git commit -m "feat: the knowledge stores have settings, a compose file, and volumes on D:"
```

---

### Task 2: Types, ids, topics, and the fakes

**Files:**
- Create: `lib/knowledge/types.ts`, `lib/knowledge/ids.ts`, `lib/knowledge/topics.ts`, `lib/knowledge/fake.ts`
- Test: `tests/knowledge.fake.test.ts`

**Interfaces:**
- Produces:

```ts
export type Space = 'handbooks' | 'reels' | 'jobs' | 'shared';
export type NodeRef = { label: string; key: Record<string, string | number> };
export type Props = Record<string, string | number | boolean | null>;
export interface GraphStore {
  mergeNode(label: string, key: Props, props: Props): Promise<void>;
  mergeEdge(from: NodeRef, rel: string, to: NodeRef, props?: Props): Promise<void>;
  query<T = Record<string, unknown>>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
  wipe(space: Space): Promise<void>;
  close(): Promise<void>;
}
export type Point = { id: string; vector: number[]; payload: Record<string, unknown> };
export type Hit = { id: string; score: number; payload: Record<string, unknown> };
export type Filter = Record<string, string | number | boolean | string[]>;
export interface VectorStore {
  ensure(collection: string, dims: number): Promise<void>;
  upsert(collection: string, points: Point[]): Promise<void>;
  search(collection: string, vector: number[], opts: { limit: number; filter?: Filter }): Promise<Hit[]>;
  deleteWhere(collection: string, filter: Filter): Promise<void>;
  count(collection: string): Promise<number>;
}
export interface Embedder { docs(texts: string[]): Promise<number[][]>; query(text: string): Promise<number[]>; dims: number }
export type Stores = { graph: GraphStore; vectors: VectorStore; embed: Embedder };
```

- `pointId(space: Space, kind: string, key: string): string` — UUID formatted from sha1, stable.
- `claimId(text: string): string` — 12 hex of sha1 of `topicKey(text)`.
- `hostOf(url: string): string` — lowercased hostname without `www.`.
- `topicKey`, `topicFromPoint` — identical to `lib/graph.ts` today.
- `FakeGraph`, `FakeVectors`, `FakeEmbed` with the interfaces above; `FakeGraph.nodes: Map<string, {label, props}>`, `FakeGraph.edges: Map<string, {from, rel, to, props}>`, `FakeGraph.answer(re: RegExp, rows: unknown[])` for `query`, `FakeGraph.queries: {cypher, params}[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/knowledge.fake.test.ts
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
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/knowledge.fake.test.ts`
Expected: FAIL, cannot resolve `@/lib/knowledge/ids`.

- [ ] **Step 3: Write types, ids, topics**

```ts
// lib/knowledge/types.ts
export type Space = 'handbooks' | 'reels' | 'jobs' | 'shared';
export const SPACES: Space[] = ['handbooks', 'reels', 'jobs', 'shared'];
export type Props = Record<string, string | number | boolean | null>;
export type NodeRef = { label: string; key: Props };

export interface GraphStore {
  mergeNode(label: string, key: Props, props: Props): Promise<void>;
  mergeEdge(from: NodeRef, rel: string, to: NodeRef, props?: Props): Promise<void>;
  query<T = Record<string, unknown>>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
  wipe(space: Space): Promise<void>;
  close(): Promise<void>;
}

export type Point = { id: string; vector: number[]; payload: Record<string, unknown> };
export type Hit = { id: string; score: number; payload: Record<string, unknown> };
export type Filter = Record<string, string | number | boolean | string[]>;

export interface VectorStore {
  ensure(collection: string, dims: number): Promise<void>;
  upsert(collection: string, points: Point[]): Promise<void>;
  search(collection: string, vector: number[], opts: { limit: number; filter?: Filter }): Promise<Hit[]>;
  deleteWhere(collection: string, filter: Filter): Promise<void>;
  count(collection: string): Promise<number>;
}

export interface Embedder {
  dims: number;
  docs(texts: string[]): Promise<number[][]>;
  query(text: string): Promise<number[]>;
}

export type Stores = { graph: GraphStore; vectors: VectorStore; embed: Embedder };
```

```ts
// lib/knowledge/ids.ts
import { createHash } from 'crypto';
import type { Space } from './types';
import { topicKey } from './topics';

/** Qdrant wants a UUID or an integer. This is a sha1 of the key laid out as a UUID, so the same key is the same point forever. */
export function pointId(space: Space, kind: string, key: string): string {
  const h = createHash('sha1').update(`${space}\u0000${kind}\u0000${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Two phrasings of one claim collide: the id is a hash of the normalised text. */
export function claimId(text: string): string {
  return createHash('sha1').update(topicKey(text)).digest('hex').slice(0, 12);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
```

```ts
// lib/knowledge/topics.ts
// Moved from lib/graph.ts unchanged, so a chapter on slicing and a reel on slicing still collide.

/** Normalises a phrase to a topic key so the same concept from different chapters collides. */
export function topicKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/[^a-z0-9+#. ]+/g, ' ')
    .replace(/\b(the|a|an|and|or|of|to|in|for|with|is|are|its|it|you|your|how|what|why|when|use|using|python|vs)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pulls the salient topic phrase out of a syllabus point ("Slicing: lst[1:4] ..." -> "slicing"). */
export function topicFromPoint(point: string): string {
  const head = point.split(/[:—–\-(]/)[0];
  return topicKey(head).split(' ').filter(Boolean).slice(0, 4).join(' ');
}
```

- [ ] **Step 4: Write the fakes**

```ts
// lib/knowledge/fake.ts
// In-memory stand-ins with the exact surface of neo4j.ts, qdrant.ts and embed.ts.
// Every writer and reader is tested against these; the real stores are covered by the
// opt-in live test only.
import type { Embedder, Filter, GraphStore, Hit, NodeRef, Point, Props, Space, VectorStore } from './types';

const keyOf = (label: string, key: Props) =>
  `${label}|${Object.keys(key).sort().map((k) => `${k}=${String(key[k])}`).join('&')}`;

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
    for (const [id, ref] of [[f, from], [t, to]] as const) {
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
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

const matches = (payload: Record<string, unknown>, filter?: Filter) =>
  !filter || Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(payload[k] as string) : payload[k] === v));

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
    const v = new Array(this.dims).fill(0);
    for (let i = 0; i < text.length; i++) v[i % this.dims] += text.charCodeAt(i) / 255;
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / n);
  }
  async docs(texts: string[]) { return texts.map((t) => this.one(t)); }
  async query(text: string) { return this.one(text); }
}
```

- [ ] **Step 5: Run it, expect pass**

Run: `npx vitest run tests/knowledge.fake.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/knowledge/types.ts lib/knowledge/ids.ts lib/knowledge/topics.ts lib/knowledge/fake.ts tests/knowledge.fake.test.ts
git commit -m "feat: the knowledge layer has its interfaces, ids, and an in-memory fake"
```

---

### Task 3: Real stores: Neo4j, Qdrant, the embedder, and the singleton

**Files:**
- Create: `lib/knowledge/neo4j.ts`, `lib/knowledge/qdrant.ts`, `lib/knowledge/embed.ts`, `lib/knowledge/stores.ts`, `lib/knowledge/chunk.ts`
- Modify: `package.json` (dependencies)
- Test: `tests/knowledge.stores.test.ts` (unit, mocked fetch), `tests/live/knowledge.live.test.ts` (opt-in)

**Interfaces:**
- Consumes: Task 2 types.
- Produces: `getStores(): Stores` (singleton from settings), `useStoresForTests(s: Stores | null)`, `chunkText(text: string, maxTokens = 400): string[]`, `Neo4jGraph`, `QdrantVectors`, `OllamaEmbed`.

- [ ] **Step 1: Install**

Run: `npm i neo4j-driver@^5.28.1 @qdrant/js-client-rest@^1.13.0`
Expected: both appear under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing unit test**

```ts
// tests/knowledge.stores.test.ts
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
```

- [ ] **Step 3: Run it, expect failure**

Run: `npx vitest run tests/knowledge.stores.test.ts`
Expected: FAIL, cannot resolve `@/lib/knowledge/chunk`.

- [ ] **Step 4: Write chunk, embed, neo4j, qdrant, stores**

```ts
// lib/knowledge/chunk.ts
/**
 * Splits page text into passages of about `maxTokens` words, breaking on sentence ends
 * where it can. A token here is a whitespace word; nomic's own tokens run ~1.3 per word,
 * so 400 words sits inside its 2048 window with room for the prefix.
 */
export function chunkText(text: string, maxTokens = 400): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const out: string[] = [];
  let cur: string[] = [];
  let count = 0;
  const flush = () => { if (cur.length) { out.push(cur.join(' ')); cur = []; count = 0; } };
  for (const s of sentences) {
    const words = s.split(' ').length;
    if (words > maxTokens) {
      flush();
      const ws = s.split(' ');
      for (let i = 0; i < ws.length; i += maxTokens) out.push(ws.slice(i, i + maxTokens).join(' '));
      continue;
    }
    if (count + words > maxTokens) flush();
    cur.push(s);
    count += words;
  }
  flush();
  return out.filter((c) => c.trim().length > 0);
}
```

```ts
// lib/knowledge/embed.ts
import { createHash } from 'crypto';
import type { Embedder } from './types';

export type EmbedOpts = { baseUrl: string; model: string; dims?: number; batch?: number; fetchImpl?: typeof fetch };

/** Ollama's /api/embed. nomic wants a task prefix; the cache is keyed on the prefixed text. */
export class OllamaEmbed implements Embedder {
  dims: number;
  private base: string;
  private model: string;
  private batch: number;
  private http: typeof fetch;
  private cache = new Map<string, number[]>();

  constructor(opts: EmbedOpts) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.dims = opts.dims ?? 768;
    this.batch = opts.batch ?? 32;
    this.http = opts.fetchImpl ?? fetch;
  }

  private async call(inputs: string[]): Promise<number[][]> {
    const out: number[][] = new Array(inputs.length);
    const misses: number[] = [];
    inputs.forEach((t, i) => {
      const hit = this.cache.get(hash(t));
      if (hit) out[i] = hit; else misses.push(i);
    });
    for (let at = 0; at < misses.length; at += this.batch) {
      const idx = misses.slice(at, at + this.batch);
      const r = await this.http(`${this.base}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: idx.map((i) => inputs[i]) }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`embed answered ${r.status}`);
      const body = (await r.json()) as { embeddings: number[][] };
      idx.forEach((i, j) => {
        out[i] = body.embeddings[j];
        this.cache.set(hash(inputs[i]), body.embeddings[j]);
      });
    }
    return out;
  }

  docs(texts: string[]) { return this.call(texts.map((t) => `search_document: ${t}`)); }
  async query(text: string) { return (await this.call([`search_query: ${text}`]))[0]; }
}

const hash = (t: string) => createHash('sha1').update(t).digest('hex');
```

```ts
// lib/knowledge/neo4j.ts
import neo4j, { type Driver } from 'neo4j-driver';
import type { GraphStore, NodeRef, Props, Space } from './types';

const ident = (s: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return s;
};

/** Every write is a MERGE on the key, then SET of the rest. Two writes of one thing are one thing. */
export class Neo4jGraph implements GraphStore {
  private driver: Driver;
  constructor(url: string, user: string, password: string) {
    this.driver = neo4j.driver(url, neo4j.auth.basic(user, password), { disableLosslessIntegers: true });
  }

  async mergeNode(label: string, key: Props, props: Props) {
    const L = ident(label);
    const keyClause = Object.keys(key).map((k) => `${ident(k)}: $key.${ident(k)}`).join(', ');
    await this.query(`MERGE (n:${L} {${keyClause}}) SET n += $props`, { key, props });
  }

  async mergeEdge(from: NodeRef, rel: string, to: NodeRef, props: Props = {}) {
    const a = Object.keys(from.key).map((k) => `${ident(k)}: $fk.${ident(k)}`).join(', ');
    const b = Object.keys(to.key).map((k) => `${ident(k)}: $tk.${ident(k)}`).join(', ');
    await this.query(
      `MERGE (a:${ident(from.label)} {${a}}) MERGE (b:${ident(to.label)} {${b}}) MERGE (a)-[r:${ident(rel)}]->(b) SET r += $props`,
      { fk: from.key, tk: to.key, props }
    );
  }

  async query<T = Record<string, unknown>>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const session = this.driver.session();
    try {
      const res = await session.run(cypher, params);
      return res.records.map((r) => r.toObject() as T);
    } finally {
      await session.close();
    }
  }

  async wipe(space: Space) {
    await this.query(`MATCH (n {space: $space}) DETACH DELETE n`, { space });
  }

  async close() { await this.driver.close(); }
}
```

```ts
// lib/knowledge/qdrant.ts
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Filter, Hit, Point, VectorStore } from './types';

const toQdrantFilter = (f?: Filter) =>
  f
    ? { must: Object.entries(f).map(([k, v]) => (Array.isArray(v) ? { key: k, match: { any: v } } : { key: k, match: { value: v } })) }
    : undefined;

export class QdrantVectors implements VectorStore {
  private c: QdrantClient;
  private known = new Set<string>();
  constructor(url: string) { this.c = new QdrantClient({ url }); }

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
    const rows = await this.c.search(collection, { vector, limit: opts.limit, filter: toQdrantFilter(opts.filter), with_payload: true });
    return rows.map((r) => ({ id: String(r.id), score: r.score, payload: (r.payload ?? {}) as Record<string, unknown> }));
  }
  async deleteWhere(collection: string, filter: Filter) {
    await this.c.delete(collection, { wait: true, filter: toQdrantFilter(filter) });
  }
  async count(collection: string) {
    const { count } = await this.c.count(collection, { exact: true });
    return count;
  }
}
```

```ts
// lib/knowledge/stores.ts
import { getSettings } from '@/lib/settings';
import { Neo4jGraph } from './neo4j';
import { QdrantVectors } from './qdrant';
import { OllamaEmbed } from './embed';
import type { Stores } from './types';

// One driver per process. Survives dev-mode reloads like the plugin log does.
const g = globalThis as unknown as { __knowledgeStores?: Stores | null; __knowledgeTestStores?: Stores | null };

export function useStoresForTests(s: Stores | null) {
  g.__knowledgeTestStores = s;
}

export function getStores(): Stores {
  if (g.__knowledgeTestStores) return g.__knowledgeTestStores;
  if (g.__knowledgeStores) return g.__knowledgeStores;
  const s = getSettings();
  g.__knowledgeStores = {
    graph: new Neo4jGraph(s.neo4jUrl, s.neo4jUser, s.neo4jPassword),
    vectors: new QdrantVectors(s.qdrantUrl),
    embed: new OllamaEmbed({ baseUrl: s.embedOllamaUrl, model: s.embedModel, dims: 768 }),
  };
  return g.__knowledgeStores;
}
```

- [ ] **Step 5: Run the unit test, expect pass**

Run: `npx vitest run tests/knowledge.stores.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the opt-in live test**

```ts
// tests/live/knowledge.live.test.ts
// Runs only with KNOWLEDGE_LIVE=1 and the compose up. Proves the real drivers speak to
// the real containers; everything else is proven against the fake.
import { describe, it, expect } from 'vitest';
import { Neo4jGraph } from '@/lib/knowledge/neo4j';
import { QdrantVectors } from '@/lib/knowledge/qdrant';

const live = process.env.KNOWLEDGE_LIVE === '1';

describe.skipIf(!live)('live stores', () => {
  it('merges twice and counts once in neo4j', async () => {
    const g = new Neo4jGraph('bolt://127.0.0.1:3124', 'neo4j', process.env.NEO4J_PASSWORD ?? 'iolar-local');
    await g.wipe('livetest' as never);
    await g.mergeNode('Topic', { key: 'live-test' }, { space: 'livetest', label: 'x' });
    await g.mergeNode('Topic', { key: 'live-test' }, { space: 'livetest', label: 'y' });
    const rows = await g.query<{ n: number }>(`MATCH (t:Topic {key: 'live-test'}) RETURN count(t) AS n`);
    expect(rows[0].n).toBe(1);
    await g.wipe('livetest' as never);
    await g.close();
  });

  it('upserts and searches in qdrant', async () => {
    const v = new QdrantVectors('http://127.0.0.1:3126');
    await v.ensure('livetest', 3);
    await v.upsert('livetest', [{ id: '11111111-1111-1111-1111-111111111111', vector: [1, 0, 0], payload: { space: 'livetest' } }]);
    const hits = await v.search('livetest', [1, 0, 0], { limit: 1, filter: { space: 'livetest' } });
    expect(hits[0].id).toBe('11111111-1111-1111-1111-111111111111');
    await v.deleteWhere('livetest', { space: 'livetest' });
  });
});
```

Add to `vitest.config.*` `exclude` nothing new; the `skipIf` handles it. Run once for real:

Run: `KNOWLEDGE_LIVE=1 npx vitest run tests/live/knowledge.live.test.ts` (PowerShell: `$env:KNOWLEDGE_LIVE='1'; npx vitest run tests/live/knowledge.live.test.ts`)
Expected: PASS, 2 tests.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit -p .` → no output.

```bash
git add package.json package-lock.json lib/knowledge/chunk.ts lib/knowledge/embed.ts lib/knowledge/neo4j.ts lib/knowledge/qdrant.ts lib/knowledge/stores.ts tests/knowledge.stores.test.ts tests/live/knowledge.live.test.ts
git commit -m "feat: real neo4j, qdrant and ollama-embed stores behind one singleton"
```

---

### Task 4: The handbooks space, and `lib/graph.ts` retired

**Files:**
- Create: `lib/knowledge/spaces/handbooks.ts`, `lib/knowledge/index.ts`
- Modify: `lib/store.ts:208-216` (`indexChapter`), `lib/db.ts` (`SCHEMA`, `dropLegacySchema`), every importer of `@/lib/graph` (find with `grep -rn "lib/graph'" lib app scripts`)
- Delete: `lib/graph.ts`
- Test: `tests/knowledge.handbooks.test.ts`; rewrite `tests/graph.test.ts` (delete the SQLite graph cases, keep the topic case pointing at `lib/knowledge/topics`)

**Interfaces:**
- Produces:

```ts
syncSubject(subject: Subject): Promise<void>
syncChapter(subject: string, chapter: string, post: Post, status: string): Promise<void>
syncBook(subject: string, chapter: string, book: Book): Promise<void>
chapterContext(subject: string, chapter: string): Promise<{ topics: {id,label,weight}[]; related: {subject,chapter,title,shared}[] }>
coveredElsewhere(subject: string, chapter: string): Promise<string[]>
searchTopics(q: string): Promise<{ id, label, weight, chapters: string | null }[]>
```
and `lib/knowledge/index.ts` exporting `knowledgeEnabled()`, `safely(name, fn)`, plus everything from `spaces/*`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/knowledge.handbooks.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { validatePost, type Post } from '@/lib/schema';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';

const post = (series: string, headings: string[]): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series, date: 'd',
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
    expect(graph.node('Chapter', { subject: 'python', slug: 'lists' })?.props).toMatchObject({ space: 'handbooks', title: 'LISTS', status: 'draft' });
    expect(graph.node('Topic', { key: 'slicing' })?.props.space).toBe('shared');
    const rels = [...graph.edges.values()].map((e) => e.rel);
    expect(rels).toContain('HAS_CHAPTER');
    expect(rels.filter((r) => r === 'COVERS').length).toBe(2);
  });

  it('is idempotent: the same chapter twice is one chapter and one edge set', async () => {
    const { syncSubject, syncChapter } = await import('@/lib/knowledge/spaces/handbooks');
    await syncSubject({ slug: 'python', name: 'Python', emoji: '', description: '' });
    await syncChapter('python', 'lists', post('LISTS', ['Slicing']), 'draft');
    const n = graph.nodes.size, e = graph.edges.size;
    await syncChapter('python', 'lists', post('LISTS', ['Slicing']), 'rendered');
    expect(graph.nodes.size).toBe(n);
    expect(graph.edges.size).toBe(e);
    expect(graph.node('Chapter', { subject: 'python', slug: 'lists' })?.props.status).toBe('rendered');
  });

  it('reads chapter context through cypher, with the chapter as a parameter', async () => {
    const { chapterContext } = await import('@/lib/knowledge/spaces/handbooks');
    graph.answer(/COVERS\]->\(t:Topic\)/, [{ id: 'topic:slicing', label: 'Slicing', weight: 2 }]);
    graph.answer(/SHARES_TOPIC|shared/, [{ subject: 'python', chapter: 'strings', title: 'STRINGS', shared: 1 }]);
    const ctx = await chapterContext('python', 'lists');
    expect(ctx.topics[0].label).toBe('Slicing');
    expect(ctx.related[0].chapter).toBe('strings');
    expect(graph.queries[0].params).toMatchObject({ subject: 'python', chapter: 'lists' });
  });

  it('never throws out of a writer when the store is down', async () => {
    const broken = new FakeGraph();
    broken.mergeNode = async () => { throw new Error('ECONNREFUSED'); };
    useStoresForTests({ graph: broken, vectors: new FakeVectors(), embed: new FakeEmbed() });
    const { syncSubject } = await import('@/lib/knowledge/spaces/handbooks');
    await expect(syncSubject({ slug: 'x', name: 'X', emoji: '', description: '' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/knowledge.handbooks.test.ts`
Expected: FAIL, cannot resolve `@/lib/knowledge/spaces/handbooks`.

- [ ] **Step 3: Write index.ts and the handbooks space**

```ts
// lib/knowledge/index.ts
import { getSettings } from '@/lib/settings';
import { logPlugin } from '@/lib/plugins/log';

export * from './types';
export { getStores, useStoresForTests } from './stores';
export { topicKey, topicFromPoint } from './topics';
export { pointId, claimId, hostOf } from './ids';

export function knowledgeEnabled(): boolean {
  return getSettings().knowledgeMemory !== false;
}

/**
 * Every writer runs inside this. A store that is down costs memory, not a save: the
 * error becomes one line on the Plugins page and the caller carries on.
 */
export async function safely<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    logPlugin('knowledge', `${what} failed: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`, 'warning');
    return undefined;
  }
}
```

```ts
// lib/knowledge/spaces/handbooks.ts
import type { Post } from '@/lib/schema';
import type { Book } from '@/lib/ai/book';
import type { Subject } from '@/lib/store';
import { getStores } from '../stores';
import { safely } from '../index';
import { topicFromPoint } from '../topics';

const subjectRef = (slug: string) => ({ label: 'Subject', key: { slug } });
const chapterRef = (subject: string, slug: string) => ({ label: 'Chapter', key: { subject, slug } });
const topicRef = (key: string) => ({ label: 'Topic', key: { key } });

export async function syncSubject(subject: Subject): Promise<void> {
  await safely('handbooks.syncSubject', async () => {
    const { graph } = getStores();
    await graph.mergeNode('Subject', { slug: subject.slug }, {
      space: 'handbooks', name: subject.name, emoji: subject.emoji, label: `${subject.emoji} ${subject.name}`.trim(),
    });
  });
}

async function linkTopic(subject: string, chapter: string, key: string, label: string) {
  const { graph } = getStores();
  await graph.mergeNode('Topic', { key }, { space: 'shared', label: label.slice(0, 60) });
  await graph.mergeEdge(chapterRef(subject, chapter), 'COVERS', topicRef(key));
}

/** Chapters teaching the same topic get a direct edge; rebuilt for this chapter on every write. */
async function rebuildShared(subject: string, chapter: string) {
  const { graph } = getStores();
  await graph.query(
    `MATCH (a:Chapter {subject: $subject, slug: $chapter})-[:COVERS]->(t:Topic)<-[:COVERS]-(b:Chapter)
     WHERE a <> b
     WITH a, b, count(t) AS n
     MERGE (a)-[r:SHARES_TOPIC]-(b) SET r.count = n`,
    { subject, chapter }
  );
}

export async function syncChapter(subject: string, chapter: string, post: Post, status: string): Promise<void> {
  await safely('handbooks.syncChapter', async () => {
    const { graph } = getStores();
    await graph.mergeNode('Chapter', { subject, slug: chapter }, {
      space: 'handbooks', title: post.series, status, parts: 1, weight: post.slides.length,
    });
    await graph.mergeEdge(subjectRef(subject), 'HAS_CHAPTER', chapterRef(subject, chapter));
    for (const slide of post.slides) {
      for (const b of slide.blocks) {
        if (b.type !== 'heading') continue;
        const key = topicFromPoint(b.text);
        if (key.length < 3) continue;
        await linkTopic(subject, chapter, key, b.text.replace(/^\d+\.\s*/, ''));
      }
    }
    await rebuildShared(subject, chapter);
  });
}

export async function syncBook(subject: string, chapter: string, book: Book): Promise<void> {
  await safely('handbooks.syncBook', async () => {
    const { graph } = getStores();
    await graph.mergeNode('Chapter', { subject, slug: chapter }, { space: 'handbooks', title: book.title, summary: book.summary });
    await graph.mergeEdge(subjectRef(subject), 'HAS_CHAPTER', chapterRef(subject, chapter));
    for (const ch of book.chapters) {
      for (const p of ch.points) {
        const key = topicFromPoint(p);
        if (key.length < 3) continue;
        await linkTopic(subject, chapter, key, p.split(/[:—–]/)[0].trim());
      }
    }
    await rebuildShared(subject, chapter);
  });
}

export async function chapterContext(subject: string, chapter: string) {
  const { graph } = getStores();
  const topics = await graph.query<{ id: string; label: string; weight: number }>(
    `MATCH (c:Chapter {subject: $subject, slug: $chapter})-[:COVERS]->(t:Topic)
     OPTIONAL MATCH (t)<-[cov:COVERS]-()
     RETURN 'topic:' + t.key AS id, t.label AS label, count(cov) AS weight ORDER BY weight DESC`,
    { subject, chapter }
  );
  const related = await graph.query<{ subject: string; chapter: string; title: string; shared: number }>(
    `MATCH (c:Chapter {subject: $subject, slug: $chapter})-[:COVERS]->(t:Topic)<-[:COVERS]-(o:Chapter)
     WHERE o <> c
     RETURN o.subject AS subject, o.slug AS chapter, o.title AS title, count(t) AS shared
     ORDER BY shared DESC LIMIT 10`,
    { subject, chapter }
  );
  return { topics, related };
}

export async function coveredElsewhere(subject: string, chapter: string): Promise<string[]> {
  const { graph } = getStores();
  const rows = await graph.query<{ label: string }>(
    `MATCH (o:Chapter)-[:COVERS]->(t:Topic)
     WHERE NOT (o.subject = $subject AND o.slug = $chapter)
     WITH DISTINCT t, size([(t)<-[:COVERS]-() | 1]) AS w
     RETURN t.label AS label ORDER BY w DESC LIMIT 60`,
    { subject, chapter }
  );
  return rows.map((r) => r.label);
}

export async function searchTopics(q: string) {
  const { graph } = getStores();
  return graph.query<{ id: string; label: string; weight: number; chapters: string | null }>(
    `MATCH (t:Topic) WHERE toLower(t.label) CONTAINS toLower($q)
     OPTIONAL MATCH (t)<-[:COVERS]-(c:Chapter)
     WITH t, collect(DISTINCT c.slug) AS chs
     RETURN 'topic:' + t.key AS id, t.label AS label, size(chs) AS weight,
            CASE WHEN size(chs) = 0 THEN null ELSE reduce(s = '', x IN chs | CASE WHEN s = '' THEN x ELSE s + ',' + x END) END AS chapters
     ORDER BY weight DESC LIMIT 50`,
    { q }
  );
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `npx vitest run tests/knowledge.handbooks.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Retire lib/graph.ts**

Run: `grep -rn "lib/graph'" lib app scripts tests` and change every import to `@/lib/knowledge/spaces/handbooks` (for `syncSubject`, `syncChapter`, `syncBook`, `chapterContext`, `coveredElsewhere`, `searchTopics`) or `@/lib/knowledge/topics` (for `topicKey`, `topicFromPoint`). `syncRenders` and `syncReferences` are SQLite bookkeeping, not graph: move them verbatim into a new `lib/handbookIndex.ts` and point their importers there. Then `git rm lib/graph.ts`.

In `lib/store.ts` `indexChapter`:

```ts
/** Mirrors content into SQLite + the knowledge graph. Never fails a save. */
async function indexChapter(subject: string, chapter: string, post: Post) {
  try {
    const { syncChapter } = await import('./knowledge/spaces/handbooks');
    await syncChapter(subject, chapter, post, 'draft');
  } catch (err) {
    console.warn('[instastudio] index failed for', subject, chapter, err);
  }
}
```

In `lib/db.ts`: delete the `nodes` and `edges` `CREATE TABLE` statements and the three graph indexes from `SCHEMA`; in `dropLegacySchema`, before the early return, add:

```ts
  // The graph moved to Neo4j on 2 September 2026. These two tables are dead weight.
  for (const t of ['nodes', 'edges']) handle.exec(`DROP TABLE IF EXISTS ${t}`);
```
and keep the rest as it is (it keys off `nodes` existing; after this it returns at the `!tables.some` check on the next open, which is fine).

In `tests/graph.test.ts`: delete the `graph` describe block; keep the `topic extraction` case but import from `@/lib/knowledge/topics`. Rename the file `tests/knowledge.topics.test.ts`.

- [ ] **Step 6: Run everything**

Run: `npx tsc --noEmit -p . && npx vitest run && npx eslint lib/knowledge lib/store.ts lib/db.ts lib/handbookIndex.ts`
Expected: typecheck clean, all tests pass, no lint errors. The handbook tests that used to assert SQLite `nodes` rows now assert through the fake.

- [ ] **Step 7: Commit**

```bash
git add -A lib/knowledge lib/store.ts lib/db.ts lib/handbookIndex.ts tests/knowledge.handbooks.test.ts tests/knowledge.topics.test.ts
git rm -q lib/graph.ts tests/graph.test.ts
git commit -m "feat: handbooks write to the knowledge graph, and lib/graph.ts is retired"
```

---

### Task 5: The reels space

**Files:**
- Create: `lib/knowledge/spaces/reels.ts`
- Modify: `lib/reel/research/store.ts:48,104,118,131,135` (`writeBrief`, `writeCandidates`, `writeSelection`, `writeScript`, `writeEvidence`), `lib/reel/research/gatherRun.ts:69` (cap)
- Test: `tests/knowledge.reels.test.ts`

**Interfaces:**
- Consumes: `Brief` (`lib/reel/research/brief.ts`), `CandidatesFile` / `Candidate` (`candidate.ts`), `Selection` (`selection.ts`), `Script` (`script.ts`), `Evidence` (`gather.ts`), `effectiveState(c, selection)` (`selection.ts`), `evidenceFor(lineText, text)` (`agents.ts`).
- Produces:

```ts
recordBrief(slug: string, brief: Brief): Promise<void>
recordHunt(slug: string, file: CandidatesFile): Promise<void>
recordReview(slug: string, candidates: Candidate[], selection: Selection): Promise<void>
recordEvidence(slug: string, candidate: Candidate, evidence: Evidence): Promise<void>
recordScript(slug: string, script: Script, candidates: Candidate[], evidence: Record<string, Evidence>): Promise<void>
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/knowledge.reels.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';
import { parseBrief } from '@/lib/reel/research/brief';
import type { Candidate } from '@/lib/reel/research/candidate';

const brief = () => parseBrief({
  runId: 'sqlite-runs-everything', createdAt: '2026-09-02T01:20:00.000Z', topic: 'SQLite runs everything',
  angle: 'x', audience: 'developers', videoFormat: 'reel',
  mustProve: ['SQLite ships in every major phone OS and browser', 'its test suite is orders of magnitude larger than the library'],
  mustInclude: [], avoid: [], recencyWindowDays: 365, sourceClasses: ['docs'],
  searchQueries: [{ class: 'docs', queries: ['sqlite'] }], referenceReel: null, status: 'briefed',
});

const cand = (over: Partial<Candidate>): Candidate => ({
  id: 'fa3ebbf3c822', url: 'https://sqlite.org/mostdeployed.html', canonicalUrl: 'https://sqlite.org/mostdeployed.html',
  title: 'Most deployed', publisher: 'sqlite.org', author: null, publishedAt: null, retrievedAt: '2026-09-02T00:00:00.000Z',
  thumbnailUrl: null, durationSec: null, summary: 's', pullQuotes: [], stats: [], assetKind: 'doc',
  whyItMatters: 'w', scoreTotal: 80, verdict: 'keep', rejectReason: null, dupeOf: null, hunterAgent: 'local',
  ...over,
} as Candidate);

let graph: FakeGraph; let vectors: FakeVectors;
beforeEach(() => {
  graph = new FakeGraph(); vectors = new FakeVectors();
  useStoresForTests({ graph, vectors, embed: new FakeEmbed() });
});

describe('the reels space', () => {
  it('records a brief as a reel about topics that must prove claims', async () => {
    const { recordBrief } = await import('@/lib/knowledge/spaces/reels');
    await recordBrief('sqlite-runs-everything', brief());
    expect(graph.node('Reel', { slug: 'sqlite-runs-everything' })?.props).toMatchObject({ space: 'reels', title: 'SQLite runs everything' });
    const rels = [...graph.edges.values()].map((e) => e.rel);
    expect(rels).toContain('ABOUT');
    expect(rels.filter((r) => r === 'MUST_PROVE').length).toBe(2);
    const claim = [...graph.nodes.values()].find((n) => n.label === 'Claim');
    expect(claim?.props.space).toBe('shared');
  });

  it('records the hunt as HUNTED edges with the verdict, and domains with counters', async () => {
    const { recordHunt } = await import('@/lib/knowledge/spaces/reels');
    await recordHunt('sqlite-runs-everything', {
      runId: 'sqlite-runs-everything', generatedAt: 'x', criticVersion: '1',
      stats: { perClass: {}, totalFound: 2, totalKept: 1, dupesCollapsed: 0 },
      candidates: [cand({}), cand({ id: '4620a739908e', url: 'https://sqlite.org/hirely.html', canonicalUrl: 'https://sqlite.org/hirely.html', verdict: 'reject', rejectReason: 'sales page' })],
    } as never);
    const hunted = [...graph.edges.values()].filter((e) => e.rel === 'HUNTED');
    expect(hunted).toHaveLength(2);
    expect(hunted.find((e) => e.to.includes('hirely'))?.props).toMatchObject({ verdict: 'reject', reason: 'sales page' });
    expect(graph.node('Domain', { host: 'sqlite.org' })?.props.space).toBe('shared');
    expect([...graph.edges.values()].filter((e) => e.rel === 'ON')).toHaveLength(2);
  });

  it('records the review as KEPT and REJECTED, from the effective state', async () => {
    const { recordReview } = await import('@/lib/knowledge/spaces/reels');
    await recordReview('sqlite-runs-everything', [cand({}), cand({ id: '4620a739908e', url: 'https://sqlite.org/hirely.html', canonicalUrl: 'https://sqlite.org/hirely.html', verdict: 'maybe' })], {
      runId: 'sqlite-runs-everything', updatedAt: 'x', fetchRequestedAt: null,
      decisions: { '4620a739908e': { state: 'reject', starred: false, note: 'dup' } },
    });
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
    expect(hit.payload).toMatchObject({ space: 'reels', reelSlug: 'sqlite-runs-everything', host: 'sqlite.org', candidateId: 'fa3ebbf3c822' });
  });

  it('records script lines, citations, proofs, flags, and a SUPPORTED_BY only for clean lines', async () => {
    const { recordScript } = await import('@/lib/knowledge/spaces/reels');
    const script = {
      runId: 'sqlite-runs-everything', createdAt: 'x', updatedAt: 'x', status: 'draft',
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
    const evidence = { fa3ebbf3c822: { candidateId: 'fa3ebbf3c822', kind: 'pagetext', retrievedAt: 'x', text: 'SQLite runs in every phone. It has 590 times as much test code.', segments: null } } as never;
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
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/knowledge.reels.test.ts`
Expected: FAIL, cannot resolve `@/lib/knowledge/spaces/reels`.

- [ ] **Step 3: Write the reels space**

```ts
// lib/knowledge/spaces/reels.ts
import type { Brief } from '@/lib/reel/research/brief';
import type { Candidate, CandidatesFile } from '@/lib/reel/research/candidate';
import type { Selection } from '@/lib/reel/research/selection';
import type { Script } from '@/lib/reel/research/script';
import type { Evidence } from '@/lib/reel/research/gather';
import { effectiveState } from '@/lib/reel/research/selection';
import { evidenceFor } from '@/lib/reel/research/agents';
import { getStores } from '../stores';
import { safely } from '../index';
import { claimId, hostOf, pointId } from '../ids';
import { topicKey } from '../topics';
import { chunkText } from '../chunk';

const reelRef = (slug: string) => ({ label: 'Reel', key: { slug } });
const sourceRef = (url: string) => ({ label: 'Source', key: { url } });
const claimRef = (text: string) => ({ label: 'Claim', key: { id: claimId(text) } });
const lineRef = (slug: string, id: string) => ({ label: 'ScriptLine', key: { reelSlug: slug, id } });

async function mergeSource(c: Candidate) {
  const { graph } = getStores();
  const url = c.canonicalUrl || c.url;
  const host = hostOf(url);
  await graph.mergeNode('Source', { url }, {
    space: 'shared', title: c.title, publisher: c.publisher, publishedAt: c.publishedAt, assetKind: c.assetKind,
  });
  if (host) {
    await graph.mergeNode('Domain', { host }, { space: 'shared' });
    await graph.mergeEdge(sourceRef(url), 'ON', { label: 'Domain', key: { host } });
  }
  return url;
}

/** Domain counters are derived from the edges, so they are always right after any write. */
async function refreshDomainCounters(hosts: Set<string>) {
  const { graph } = getStores();
  for (const host of hosts) {
    await graph.query(
      `MATCH (d:Domain {host: $host})
       OPTIONAL MATCH (d)<-[:ON]-(s:Source)<-[k:KEPT]-(:Reel)
       WITH d, count(DISTINCT k) AS kept
       OPTIONAL MATCH (d)<-[:ON]-(s2:Source)<-[r:REJECTED]-(:Reel)
       WITH d, kept, count(DISTINCT r) AS rejected
       OPTIONAL MATCH (d)<-[:ON]-(s3:Source)<-[h:HUNTED]-(:Reel) WHERE h.reason CONTAINS 'wall' OR h.reason CONTAINS 'unreadable' OR h.reason CONTAINS 'Cloudflare'
       WITH d, kept, rejected, count(DISTINCT h) AS walled
       SET d.kept = kept, d.rejected = rejected, d.walled = walled`,
      { host }
    );
  }
}

export async function recordBrief(slug: string, brief: Brief): Promise<void> {
  await safely('reels.recordBrief', async () => {
    const { graph } = getStores();
    await graph.mergeNode('Reel', { slug }, { space: 'reels', title: brief.topic, angle: brief.angle, audience: brief.audience, status: brief.status, updatedAt: new Date().toISOString() });
    const key = topicKey(brief.topic);
    if (key.length >= 3) {
      await graph.mergeNode('Topic', { key }, { space: 'shared', label: brief.topic.slice(0, 60) });
      await graph.mergeEdge(reelRef(slug), 'ABOUT', { label: 'Topic', key: { key } });
    }
    for (const text of brief.mustProve) {
      await graph.mergeNode('Claim', { id: claimId(text) }, { space: 'shared', text, key: topicKey(text) });
      await graph.mergeEdge(reelRef(slug), 'MUST_PROVE', claimRef(text));
    }
  });
}

export async function recordHunt(slug: string, file: CandidatesFile): Promise<void> {
  await safely('reels.recordHunt', async () => {
    const { graph } = getStores();
    const hosts = new Set<string>();
    for (const c of file.candidates) {
      const url = await mergeSource(c);
      hosts.add(hostOf(url));
      await graph.mergeEdge(reelRef(slug), 'HUNTED', sourceRef(url), {
        verdict: c.verdict, score: c.scoreTotal, reason: c.rejectReason ?? c.whyItMatters, hunterAgent: c.hunterAgent, at: file.generatedAt,
      });
    }
    await refreshDomainCounters(hosts);
  });
}

export async function recordReview(slug: string, candidates: Candidate[], selection: Selection): Promise<void> {
  await safely('reels.recordReview', async () => {
    const { graph } = getStores();
    const hosts = new Set<string>();
    for (const c of candidates) {
      const url = c.canonicalUrl || c.url;
      hosts.add(hostOf(url));
      const state = effectiveState(c, selection);
      if (state === 'keep') await graph.mergeEdge(reelRef(slug), 'KEPT', sourceRef(url), { at: selection.updatedAt });
      else if (state === 'reject') {
        const note = selection.decisions[c.id]?.note ?? c.rejectReason ?? '';
        await graph.mergeEdge(reelRef(slug), 'REJECTED', sourceRef(url), { reason: note, at: selection.updatedAt });
      }
    }
    await refreshDomainCounters(hosts);
  });
}

export async function recordEvidence(slug: string, candidate: Candidate, evidence: Evidence): Promise<void> {
  await safely('reels.recordEvidence', async () => {
    const { vectors, embed } = getStores();
    const url = candidate.canonicalUrl || candidate.url;
    const chunks = chunkText(evidence.text);
    if (!chunks.length) return;
    await vectors.ensure('passages', embed.dims);
    const vecs = await embed.docs(chunks);
    await vectors.upsert('passages', chunks.map((text, i) => ({
      id: pointId('reels', 'passage', `${url}#${i}`),
      vector: vecs[i],
      payload: { space: 'reels', reelSlug: slug, sourceUrl: url, host: hostOf(url), candidateId: candidate.id, kind: evidence.kind, chunk: i, text, retrievedAt: evidence.retrievedAt },
    })));
  });
}

export async function recordScript(slug: string, script: Script, candidates: Candidate[], evidence: Record<string, Evidence>): Promise<void> {
  await safely('reels.recordScript', async () => {
    const { graph, vectors, embed } = getStores();
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const flagged = new Map(script.flags.map((f) => [f.lineId, f.issue]));
    const provesByLine = new Map<string, string[]>();
    for (const cov of script.coverage) for (const id of cov.lineIds) provesByLine.set(id, [...(provesByLine.get(id) ?? []), cov.claim]);
    const supported: { text: string; url: string }[] = [];

    for (const line of script.lines) {
      await graph.mergeNode('ScriptLine', { reelSlug: slug, id: line.id }, { space: 'reels', role: line.role, text: line.text, status: script.status, order: line.order });
      await graph.mergeEdge(reelRef(slug), 'HAS_LINE', lineRef(slug, line.id));
      for (const cid of line.citations) {
        const c = byId.get(cid);
        if (!c) continue;
        const url = await mergeSource(c);
        await graph.mergeEdge(lineRef(slug, line.id), 'CITES', sourceRef(url));
        const issue = flagged.get(line.id);
        if (issue) await graph.mergeEdge(lineRef(slug, line.id), 'FLAGGED', sourceRef(url), { issue });
        for (const claim of provesByLine.get(line.id) ?? []) {
          await graph.mergeNode('Claim', { id: claimId(claim) }, { space: 'shared', text: claim, key: topicKey(claim) });
          await graph.mergeEdge(lineRef(slug, line.id), 'PROVES', claimRef(claim));
          if (!issue) {
            const text = evidence[cid]?.text ?? '';
            const passage = text ? evidenceFor(line.text, text, 600) : '';
            const figure = (line.text.match(/\d[\d,.]*/) ?? [''])[0];
            await graph.mergeEdge(claimRef(claim), 'SUPPORTED_BY', sourceRef(url), { passage, figure, reelSlug: slug, lineId: line.id, at: script.updatedAt });
            supported.push({ text: claim, url });
          }
        }
      }
    }

    if (supported.length) {
      await vectors.ensure('claims', embed.dims);
      const vecs = await embed.docs(supported.map((s) => s.text));
      await vectors.upsert('claims', supported.map((s, i) => ({
        id: pointId('shared', 'claim', claimId(s.text)),
        vector: vecs[i],
        payload: { space: 'shared', key: claimId(s.text), text: s.text, reelSlug: slug, supportedBy: [s.url], verifiedAt: script.updatedAt },
      })));
    }
  });
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `npx vitest run tests/knowledge.reels.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the writers into the research store**

In `lib/reel/research/store.ts`, add at the top:

```ts
import { knowledgeEnabled } from '@/lib/knowledge';
```

and change the five writers so each records after its file write (the graph mirrors the file, never the other way round):

```ts
export async function writeBrief(slug: string, brief: Brief): Promise<void> {
  await writeJson(briefPath(slug), brief);              // whatever the existing body is, unchanged
  if (knowledgeEnabled()) await (await import('@/lib/knowledge/spaces/reels')).recordBrief(slug, brief);
}

export async function writeCandidates(slug: string, file: CandidatesFile): Promise<void> {
  await writeJson(candidatesPath(slug), file);
  if (knowledgeEnabled()) await (await import('@/lib/knowledge/spaces/reels')).recordHunt(slug, file);
}

export async function writeSelection(slug: string, selection: Selection): Promise<void> {
  await writeJson(selectionPath(slug), selection);
  if (knowledgeEnabled()) {
    const { candidates } = await readCandidates(slug);
    await (await import('@/lib/knowledge/spaces/reels')).recordReview(slug, candidates, selection);
  }
}

export async function writeEvidence(slug: string, evidence: Evidence): Promise<void> {
  await writeJson(evidencePath(slug, evidence.candidateId), evidence);
  if (knowledgeEnabled()) {
    const { candidates } = await readCandidates(slug);
    const c = candidates.find((x) => x.id === evidence.candidateId);
    if (c) await (await import('@/lib/knowledge/spaces/reels')).recordEvidence(slug, c, evidence);
  }
}

export async function writeScript(slug: string, script: Script): Promise<void> {
  await writeJson(scriptPath(slug), script);
  if (knowledgeEnabled()) {
    const [{ candidates }, evidence] = await Promise.all([readCandidates(slug), readAllEvidence(slug)]);
    await (await import('@/lib/knowledge/spaces/reels')).recordScript(slug, script, candidates, evidence);
  }
}
```

Keep each function's existing file-writing line exactly as it is; only append the `if (knowledgeEnabled())` block. The dynamic import keeps the store module free of Neo4j at import time, which matters for tests that mock nothing.

In `lib/reel/research/gatherRun.ts` line 69 change `.slice(0, 20_000)` to `.slice(0, 200_000)` with the comment:

```ts
    // 200k, not 20k: NIST SP 800-63B is 354 KB and its memorized-secrets section sat past
    // the old cap, so the verifier flagged true lines. Passages are chunked from all of
    // this; only the prompt window stays small.
    .slice(0, 200_000);
```

- [ ] **Step 6: Run the research tests with the fake stores**

The research test files (`tests/research.*.test.ts`, `tests/api.reel.research.test.ts`) construct stores on disk. They must not reach a real Neo4j. Add to `tests/setup.ts` (create it if absent, and register it in `vitest.config.*` `setupFiles`):

```ts
// tests/setup.ts
import { beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';

// No test ever talks to a real store. The live test opts out by constructing drivers itself.
beforeEach(() => {
  useStoresForTests({ graph: new FakeGraph(), vectors: new FakeVectors(), embed: new FakeEmbed() });
});
```

Run: `npx vitest run`
Expected: all pass. `tests/knowledge.handbooks.test.ts` and `tests/knowledge.reels.test.ts` override the fake per test, which is fine.

- [ ] **Step 7: Commit**

```bash
git add lib/knowledge/spaces/reels.ts lib/reel/research/store.ts lib/reel/research/gatherRun.ts tests/knowledge.reels.test.ts tests/setup.ts vitest.config.*
git commit -m "feat: a reel's research writes its sources, claims, lines and passages to the knowledge layer"
```

---

### Task 6: The jobs space

**Files:**
- Create: `lib/knowledge/spaces/jobs.ts`
- Modify: `lib/jobs/board.ts` (add `readWeek`), `app/api/jobs/weeks/route.ts`
- Test: `tests/knowledge.jobs.test.ts`, `tests/jobs.board.test.ts` (one case)

**Interfaces:**
- Consumes: the board's `GET /api/weeks/{week}` shape: `{ week, stage, jobs: { jobs: Job[], rejected: [] } | null, summary: Summary | null, reel: { style, world?, highlights?: {highlight, scene, score}[] } | null, hasExport }` where `Job = { id, role, company, function, location, workMode, experienceMin, experienceMax, salaryMin, salaryMax, currency, link }`.
- Produces: `readWeek(week: string, opts?: BoardOpts): Promise<WeekView>` in `lib/jobs/board.ts`; `recordWeek(view: WeekView): Promise<void>` in the jobs space; `indexedStage(week: string): Promise<string | null>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/knowledge.jobs.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';

let graph: FakeGraph;
beforeEach(() => {
  graph = new FakeGraph();
  useStoresForTests({ graph, vectors: new FakeVectors(), embed: new FakeEmbed() });
});

const view = {
  week: '2026-W46', stage: 'exported', hasExport: true, hasVoice: true,
  summary: null,
  reel: { style: 'feed', world: 'feed-native', highlights: [{ highlight: 'salary-spread', scene: 'stat-bars', score: 0.6 }] },
  jobs: {
    week: '2026-W46', importedAt: 'x', source: { kind: 'sheet', url: 'u' }, rejected: [], warnings: [],
    jobs: [
      { id: '1', role: 'SRE', company: 'Acme', function: 'engineering', location: 'Bengaluru', workMode: 'remote', experienceMin: 2, experienceMax: 5, salaryMin: null, salaryMax: null, currency: 'INR', link: 'https://a' },
      { id: '2', role: 'SRE 2', company: 'Acme', function: 'engineering', location: 'Pune', workMode: 'onsite', experienceMin: 2, experienceMax: 5, salaryMin: null, salaryMax: null, currency: 'INR', link: 'https://b' },
      { id: '3', role: 'PM', company: 'Globex', function: 'product', location: 'Pune', workMode: 'hybrid', experienceMin: 5, experienceMax: 9, salaryMin: null, salaryMax: null, currency: 'INR', link: 'https://c' },
    ],
  },
};

describe('the jobs space', () => {
  it('records a week with employers, functions, cities, modes and highlights, counted', async () => {
    const { recordWeek } = await import('@/lib/knowledge/spaces/jobs');
    await recordWeek(view as never);
    expect(graph.node('Week', { week: '2026-W46' })?.props).toMatchObject({ space: 'jobs', stage: 'exported', counted: 3, style: 'feed', world: 'feed-native' });
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
    const n = graph.nodes.size, e = graph.edges.size;
    await recordWeek(view as never);
    expect([graph.nodes.size, graph.edges.size]).toEqual([n, e]);
  });

  it('reports the stage it last indexed a week at', async () => {
    const { indexedStage } = await import('@/lib/knowledge/spaces/jobs');
    graph.answer(/MATCH \(w:Week \{week: \$week\}\)/, [{ stage: 'planned' }]);
    expect(await indexedStage('2026-W46')).toBe('planned');
  });
});
```

And in `tests/jobs.board.test.ts` add:

```ts
describe('reading one week', () => {
  it('asks the board for the full week view', async () => {
    const { readWeek } = await import('@/lib/jobs/board');
    const { f, calls } = fetchWith(() => ({ body: { week: '2026-W46', stage: 'exported', jobs: null, summary: null, reel: null, hasExport: true, hasVoice: true } }));
    const v = await readWeek('2026-W46', { baseUrl: 'http://127.0.0.1:26100', fetchImpl: f });
    expect(calls[0].url).toBe('http://127.0.0.1:26100/api/weeks/2026-W46');
    expect(v.stage).toBe('exported');
    await expect(readWeek('../x', { fetchImpl: f })).rejects.toThrow(/not a week/);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/knowledge.jobs.test.ts tests/jobs.board.test.ts`
Expected: FAIL on both new files.

- [ ] **Step 3: Write readWeek and the jobs space**

Append to `lib/jobs/board.ts`:

```ts
export type BoardJob = {
  id: string; role: string; company: string; function: string; location: string; workMode: string;
  experienceMin: number; experienceMax: number; salaryMin: number | null; salaryMax: number | null; currency: string; link: string;
};
export type WeekView = {
  week: string; stage: WeekStage; hasExport: boolean; hasVoice: boolean;
  jobs: { jobs: BoardJob[]; rejected: unknown[] } | null;
  summary: Record<string, unknown> | null;
  reel: { style?: string | null; world?: string | null; highlights?: { highlight: string; scene: string; score: number }[] } | null;
};

export async function readWeek(week: string, opts: BoardOpts = {}): Promise<WeekView> {
  if (!SAFE_WEEK.test(week)) throw new Error(`"${week}" is not a week like 2026-W36`);
  const { base, http } = client(opts);
  let res: Response;
  try {
    res = await http(`${base}/api/weeks/${week}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new BoardDown(`jobs-reel board is not answering on ${base}: ${String(err instanceof Error ? err.message : err)}`);
  }
  if (!res.ok) throw new BoardDown(`jobs-reel board answered ${res.status}`);
  return (await res.json()) as WeekView;
}
```

```ts
// lib/knowledge/spaces/jobs.ts
import type { WeekView } from '@/lib/jobs/board';
import { getStores } from '../stores';
import { safely } from '../index';
import { topicKey } from '../topics';

const weekRef = (week: string) => ({ label: 'Week', key: { week } });

const count = <T,>(items: T[], by: (t: T) => string) => {
  const m = new Map<string, number>();
  for (const it of items) { const k = by(it); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
};

export async function recordWeek(view: WeekView): Promise<void> {
  await safely('jobs.recordWeek', async () => {
    const { graph } = getStores();
    const jobs = view.jobs?.jobs ?? [];
    await graph.mergeNode('Week', { week: view.week }, {
      space: 'jobs', stage: view.stage, counted: jobs.length, rejected: view.jobs?.rejected.length ?? 0,
      style: view.reel?.style ?? null, world: view.reel?.world ?? null, hasExport: view.hasExport,
    });
    for (const [name, n] of count(jobs, (j) => j.company.trim())) {
      await graph.mergeNode('Employer', { name }, { space: 'jobs' });
      await graph.mergeEdge(weekRef(view.week), 'LISTS', { label: 'Employer', key: { name } }, { count: n });
    }
    for (const [name, n] of count(jobs, (j) => j.function)) {
      await graph.mergeNode('Function', { name }, { space: 'jobs' });
      await graph.mergeEdge(weekRef(view.week), 'IN', { label: 'Function', key: { name } }, { count: n });
    }
    for (const [name, n] of count(jobs, (j) => j.location.trim())) {
      await graph.mergeNode('City', { name }, { space: 'jobs' });
      await graph.mergeEdge(weekRef(view.week), 'IN', { label: 'City', key: { name } }, { count: n });
    }
    for (const [name, n] of count(jobs, (j) => j.workMode)) {
      await graph.mergeNode('WorkMode', { name }, { space: 'jobs' });
      await graph.mergeEdge(weekRef(view.week), 'MODE', { label: 'WorkMode', key: { name } }, { count: n });
    }
    for (const h of view.reel?.highlights ?? []) {
      const key = topicKey(h.highlight.replace(/-/g, ' '));
      if (key.length < 3) continue;
      await graph.mergeNode('Topic', { key }, { space: 'shared', label: h.highlight });
      await graph.mergeEdge(weekRef(view.week), 'HIGHLIGHT', { label: 'Topic', key: { key } }, { score: h.score, scene: h.scene });
    }
  });
}

export async function indexedStage(week: string): Promise<string | null> {
  const { graph } = getStores();
  const rows = await graph.query<{ stage: string }>(`MATCH (w:Week {week: $week}) RETURN w.stage AS stage`, { week });
  return rows[0]?.stage ?? null;
}
```

In `app/api/jobs/weeks/route.ts`, after `weeks` is computed and before the response, index anything the graph has not seen at its current stage. This runs in the background of the request so the tab never waits on Neo4j:

```ts
import { knowledgeEnabled } from '@/lib/knowledge';
// ...
    if (knowledgeEnabled()) {
      void (async () => {
        const { indexedStage, recordWeek } = await import('@/lib/knowledge/spaces/jobs');
        const { readWeek } = await import('@/lib/jobs/board');
        for (const w of weeks) {
          if ((await indexedStage(w.week)) === w.stage) continue;
          await recordWeek(await readWeek(w.week));
        }
      })().catch(() => {});
    }
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/knowledge.jobs.test.ts tests/jobs.board.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/spaces/jobs.ts lib/jobs/board.ts app/api/jobs/weeks/route.ts tests/knowledge.jobs.test.ts tests/jobs.board.test.ts
git commit -m "feat: weeks from the jobs board land in the jobs space of the graph"
```

---

### Task 7: Reindex from disk

**Files:**
- Create: `scripts/reindex-knowledge.mts`
- Modify: `package.json` scripts
- Test: `tests/knowledge.reindex.test.ts`

**Interfaces:**
- Consumes: every writer above; `lib/store.ts` `listSubjects()`, `listChapters(subject)`, `loadPost(subject, chapter, part)` (check exact names in `lib/store.ts` before writing and use those); `lib/reel/research/store.ts` readers; `lib/jobs/board.ts` `listWeeks`, `readWeek`.
- Produces: `reindexKnowledge(opts: { spaces: Space[]; wipe: boolean; log?: (s: string) => void }): Promise<{ handbooks: number; reels: number; jobs: number }>` in `lib/knowledge/reindex.ts`; the script is a thin CLI over it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/knowledge.reindex.test.ts
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
    writeFileSync(path.join(dir, 'brief.json'), JSON.stringify({
      runId: 'r1', createdAt: '2026-09-02T00:00:00.000Z', topic: 'Topic one', angle: 'a', audience: 'b', videoFormat: 'reel',
      mustProve: ['claim one', 'claim two'], mustInclude: [], avoid: [], recencyWindowDays: 30, sourceClasses: ['docs'],
      searchQueries: [{ class: 'docs', queries: ['q'] }], referenceReel: null, status: 'briefed',
    }));
    const { reindexKnowledge } = await import('@/lib/knowledge/reindex');
    const out = await reindexKnowledge({ spaces: ['reels'], wipe: true });
    expect(out.reels).toBe(1);
    expect(graph.node('Reel', { slug: 'r1' })).toBeTruthy();
  });

  it('wipes only the spaces it was asked to', async () => {
    await graph.mergeNode('Week', { week: '2026-W01' }, { space: 'jobs' });
    const { reindexKnowledge } = await import('@/lib/knowledge/reindex');
    vi.doMock('@/lib/jobs/board', () => ({ listWeeks: async () => { throw new Error('board down'); }, readWeek: async () => { throw new Error('x'); } }));
    await reindexKnowledge({ spaces: ['reels'], wipe: true });
    expect(graph.node('Week', { week: '2026-W01' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/knowledge.reindex.test.ts`
Expected: FAIL, cannot resolve `@/lib/knowledge/reindex`.

- [ ] **Step 3: Write reindex.ts and the script**

```ts
// lib/knowledge/reindex.ts
import { promises as fs } from 'fs';
import path from 'path';
import type { Space } from './types';
import { getStores } from './stores';

/**
 * Rebuilds the stores from what is on disk and on the jobs board. Every writer is a MERGE,
 * so this is safe to run on a live graph; --wipe first is what makes it a rebuild rather
 * than a top-up.
 */
export async function reindexKnowledge(opts: { spaces: Space[]; wipe: boolean; log?: (s: string) => void }) {
  const log = opts.log ?? (() => {});
  const { graph, vectors } = getStores();
  const out = { handbooks: 0, reels: 0, jobs: 0 };

  if (opts.wipe) {
    for (const s of opts.spaces) {
      await graph.wipe(s);
      if (s === 'reels') for (const c of ['passages', 'claims']) await vectors.deleteWhere(c, { space: s }).catch(() => {});
      log(`wiped ${s}`);
    }
  }

  if (opts.spaces.includes('handbooks')) {
    const store = await import('@/lib/store');
    const hb = await import('./spaces/handbooks');
    for (const subject of await store.listSubjects()) {
      await hb.syncSubject(subject);
      for (const chapter of await store.listChapters(subject.slug)) {
        const post = await store.loadPost(subject.slug, chapter.slug, 1).catch(() => null);
        if (post) { await hb.syncChapter(subject.slug, chapter.slug, post, chapter.status ?? 'draft'); out.handbooks++; }
        const book = await store.loadBook?.(subject.slug, chapter.slug).catch(() => null);
        if (book) await hb.syncBook(subject.slug, chapter.slug, book);
      }
    }
    log(`handbooks: ${out.handbooks} chapters`);
  }

  if (opts.spaces.includes('reels')) {
    const { dataRoot } = await import('@/lib/paths');
    const rs = await import('@/lib/reel/research/store');
    const reels = await import('./spaces/reels');
    const root = path.join(dataRoot(), 'reel');
    const slugs = await fs.readdir(root).catch(() => [] as string[]);
    for (const slug of slugs) {
      const dir = path.join(root, slug, 'research');
      if (!(await fs.stat(path.join(dir, 'brief.json')).catch(() => null))) continue;
      const brief = await rs.readBrief(slug);
      await reels.recordBrief(slug, brief);
      const cands = await rs.readCandidates(slug).catch(() => null);
      if (cands) {
        await reels.recordHunt(slug, cands);
        const selection = await rs.readSelection(slug).catch(() => null);
        if (selection) await reels.recordReview(slug, cands.candidates, selection);
        const evidence = await rs.readAllEvidence(slug).catch(() => ({}));
        for (const c of cands.candidates) if (evidence[c.id]) await reels.recordEvidence(slug, c, evidence[c.id]);
        const script = await rs.readScript(slug).catch(() => null);
        if (script) await reels.recordScript(slug, script, cands.candidates, evidence);
      }
      out.reels++;
      log(`reel ${slug}`);
    }
  }

  if (opts.spaces.includes('jobs')) {
    try {
      const board = await import('@/lib/jobs/board');
      const jobs = await import('./spaces/jobs');
      for (const w of await board.listWeeks()) {
        await jobs.recordWeek(await board.readWeek(w.week));
        out.jobs++;
      }
      log(`jobs: ${out.jobs} weeks`);
    } catch (err) {
      log(`jobs skipped: ${String(err instanceof Error ? err.message : err)}`);
    }
  }
  return out;
}
```

Check the exact reader names in `lib/store.ts` (`listSubjects`, `listChapters`, `loadPost`, `loadBook` or their real names) and use those; the test only exercises the reels branch.

```ts
// scripts/reindex-knowledge.mts
// npx tsx scripts/reindex-knowledge.mts [--space handbooks|reels|jobs]... [--wipe]
import { reindexKnowledge } from '../lib/knowledge/reindex';
import type { Space } from '../lib/knowledge/types';

const args = process.argv.slice(2);
const wipe = args.includes('--wipe');
const spaces = args.flatMap((a, i) => (a === '--space' ? [args[i + 1] as Space] : []));
const out = await reindexKnowledge({ spaces: spaces.length ? spaces : ['handbooks', 'reels', 'jobs'], wipe, log: console.log });
console.log(out);
process.exit(0);
```

Add to `package.json` scripts: `"reindex:knowledge": "tsx scripts/reindex-knowledge.mts"`.

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/knowledge.reindex.test.ts`
Expected: PASS.

- [ ] **Step 5: Run it for real, once**

Run: `npm run reindex:knowledge -- --wipe`
Expected: log lines for 2 handbook chapters, ~22 reels, 11 weeks; then in the Neo4j browser at `http://127.0.0.1:3125` run `MATCH (n) RETURN n.space, count(n)` and see all four spaces.

- [ ] **Step 6: Commit**

```bash
git add lib/knowledge/reindex.ts scripts/reindex-knowledge.mts package.json tests/knowledge.reindex.test.ts
git commit -m "feat: one command rebuilds the knowledge stores from disk and the board"
```

---

### Task 8: Plugin cards for the two stores

**Files:**
- Modify: `lib/plugins/registry.ts`, `lib/plugins/health.ts`
- Test: `tests/plugins.health.test.ts`

**Interfaces:**
- Produces: registry entries `neo4j` (port 3125, health `http://127.0.0.1:3125/`, open link same, start `docker compose -f docker/compose.yml up -d iolar-neo4j` in the studio root) and `qdrant` (port 3126, health `http://127.0.0.1:3126/healthz`, open `http://127.0.0.1:3126/dashboard`, start `… up -d iolar-qdrant`). `PluginName` gains `'neo4j' | 'qdrant'`.

- [ ] **Step 1: Write the failing test**

In `tests/plugins.health.test.ts` change the registry list assertion to include the two names, the startable list too, and add:

```ts
  it('watches the two knowledge stores and can start either with compose', async () => {
    mockFetch({
      ':3125': { body: {} },
      ':3126': { status: 200, body: {} },
      ':26100': { body: { ok: true, weeks: 1 } }, ':25100': { body: { ollama: { ok: true }, channels: [] } },
      ':8300': { body: { ok: true, checks: {} } }, ':8080': { body: { ok: true } }, ':8189': { body: {} }, ':11436': { body: {} },
    });
    const { readHealth } = await import('@/lib/plugins/health');
    const all = await readHealth();
    const neo = all.find((p) => p.name === 'neo4j')!, q = all.find((p) => p.name === 'qdrant')!;
    expect(neo).toMatchObject({ up: true, ready: true, port: 3125, startHint: 'docker compose -f docker/compose.yml up -d iolar-neo4j' });
    expect(q).toMatchObject({ up: true, ready: true, port: 3126, openUrl: 'http://127.0.0.1:3126/dashboard' });
  });
```

Note the health probe's `ask()` calls `res.json()`. Neo4j's `/` answers JSON (its discovery document); Qdrant's `/healthz` answers plain text `healthz check passed`, so the qdrant branch must not parse JSON. Handle that in `probe`: if `p.name === 'qdrant'`, do a text fetch instead of `ask`.

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/plugins.health.test.ts`
Expected: FAIL on the list assertions.

- [ ] **Step 3: Add the entries and the branches**

Registry, after the `jobsreel` entry:

```ts
  {
    name: 'neo4j',
    label: 'Neo4j',
    port: 3125,
    healthUrl: 'http://127.0.0.1:3125/',
    what: 'The knowledge graph: handbooks, reels and jobs, one space each. Rebuildable from data/.',
    openUrl: 'http://127.0.0.1:3125/',
    start: { command: 'docker', args: ['compose', '-f', 'docker/compose.yml', 'up', '-d', 'iolar-neo4j'], cwd: process.cwd(), hint: 'docker compose -f docker/compose.yml up -d iolar-neo4j' },
  },
  {
    name: 'qdrant',
    label: 'Qdrant',
    port: 3126,
    healthUrl: 'http://127.0.0.1:3126/healthz',
    what: 'Passages and verified claims, the research agents\u2019 memory.',
    openUrl: 'http://127.0.0.1:3126/dashboard',
    start: { command: 'docker', args: ['compose', '-f', 'docker/compose.yml', 'up', '-d', 'iolar-qdrant'], cwd: process.cwd(), hint: 'docker compose -f docker/compose.yml up -d iolar-qdrant' },
  },
```

Health, inside `probe` before `const body = await ask(p.healthUrl)`:

```ts
    if (p.name === 'qdrant') {
      const res = await fetch(p.healthUrl, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      return { ...base, up: true, ready: true, checks: [{ label: 'answering', ok: true }] };
    }
```
and after the `jobsreel` branch:

```ts
    if (p.name === 'neo4j') {
      return { ...base, up: true, ready: true, checks: [{ label: 'answering', ok: true }] };
    }
```

Node and point counts on the cards come in the companion plan once `recall.ts` exists; keep the cards to liveness here.

- [ ] **Step 4: Run, expect pass; then look**

Run: `npx vitest run tests/plugins.health.test.ts` → PASS. Open `http://localhost:3120/plugins` and see both cards green.

- [ ] **Step 5: Commit**

```bash
git add lib/plugins/registry.ts lib/plugins/health.ts tests/plugins.health.test.ts
git commit -m "feat: neo4j and qdrant are cards on the plugins page, started with compose"
```

---

### Task 9: The view module and the graph API

**Files:**
- Create: `lib/knowledge/view.ts`
- Modify: `app/api/graph/route.ts`
- Test: `tests/knowledge.view.test.ts`

**Interfaces:**
- Produces:

```ts
export type ViewNode = { id: string; label: string; kind: string; space: Space; degree: number };
export type ViewEdge = { source: string; target: string; rel: string };
spaceGraph(space: 'handbooks' | 'reels' | 'jobs', limit = 400): Promise<{ nodes: ViewNode[]; edges: ViewEdge[] }>
crossLinks(limit = 400): Promise<{ nodes: ViewNode[]; edges: ViewEdge[] }>
labelSearch(space: string, q: string): Promise<ViewNode[]>
meaningSearch(space: string, q: string): Promise<{ collection: string; score: number; text: string; payload: Record<string, unknown> }[]>
```
Node ids are `${label}:${JSON of key values joined by '/'}` built in Cypher as `labels(n)[0] + ':' + coalesce(n.slug, n.key, n.url, n.host, n.id, n.week, n.name, toString(id(n)))` so the page never needs the driver's internal ids.

- [ ] **Step 1: Write the failing test**

```ts
// tests/knowledge.view.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';

let graph: FakeGraph; let vectors: FakeVectors;
beforeEach(() => {
  graph = new FakeGraph(); vectors = new FakeVectors();
  useStoresForTests({ graph, vectors, embed: new FakeEmbed() });
});

describe('the graph view', () => {
  it('asks for one space, capped, most connected first, and shapes it for the renderer', async () => {
    graph.answer(/WHERE n\.space = \$space OR n\.space = 'shared'/, [
      { id: 'Reel:x', label: 'X', kind: 'Reel', space: 'reels', degree: 3 },
      { id: 'Topic:sqlite', label: 'SQLite', kind: 'Topic', space: 'shared', degree: 2 },
    ]);
    graph.answer(/RETURN .*AS source, .*AS target, type\(r\) AS rel/, [{ source: 'Reel:x', target: 'Topic:sqlite', rel: 'ABOUT' }]);
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

  it('meaning search embeds the query and searches the space\'s collections', async () => {
    await vectors.ensure('passages', 8);
    const e = new FakeEmbed();
    await vectors.upsert('passages', [{ id: 'p1', vector: await e.query('sqlite test suite'), payload: { space: 'reels', text: 'The test suite is 590 times larger.', reelSlug: 'x' } }]);
    const { meaningSearch } = await import('@/lib/knowledge/view');
    const hits = await meaningSearch('reels', 'sqlite test suite');
    expect(hits[0]).toMatchObject({ collection: 'passages', text: 'The test suite is 590 times larger.' });
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/knowledge.view.test.ts`
Expected: FAIL, cannot resolve `@/lib/knowledge/view`.

- [ ] **Step 3: Write view.ts**

```ts
// lib/knowledge/view.ts
import { getStores } from './stores';
import type { Space } from './types';

export type ViewNode = { id: string; label: string; kind: string; space: Space; degree: number };
export type ViewEdge = { source: string; target: string; rel: string };

const NODE_ID = `labels(n)[0] + ':' + coalesce(n.slug, n.key, n.url, n.host, n.id, n.week, n.name, toString(id(n)))`;
const NODE_LABEL = `coalesce(n.label, n.title, n.text, n.name, n.host, n.url, n.week, n.slug, n.key)`;

const EDGES = `
  MATCH (n)-[r]->(m)
  WHERE (${NODE_ID}) IN $ids AND (labels(m)[0] + ':' + coalesce(m.slug, m.key, m.url, m.host, m.id, m.week, m.name, toString(id(m)))) IN $ids
  RETURN ${NODE_ID} AS source,
         labels(m)[0] + ':' + coalesce(m.slug, m.key, m.url, m.host, m.id, m.week, m.name, toString(id(m))) AS target,
         type(r) AS rel`;

async function withEdges(nodes: ViewNode[]) {
  const { graph } = getStores();
  const ids = nodes.map((n) => n.id);
  const edges = ids.length ? await graph.query<ViewEdge>(EDGES, { ids }) : [];
  return { nodes, edges };
}

export async function spaceGraph(space: 'handbooks' | 'reels' | 'jobs', limit = 400) {
  const { graph } = getStores();
  const nodes = await graph.query<ViewNode>(
    `MATCH (n) WHERE n.space = $space OR n.space = 'shared'
     WITH n, size([(n)--() | 1]) AS degree
     WHERE n.space = $space OR degree > 0
     RETURN ${NODE_ID} AS id, ${NODE_LABEL} AS label, labels(n)[0] AS kind, n.space AS space, degree
     ORDER BY degree DESC LIMIT $limit`,
    { space, limit }
  );
  return withEdges(nodes);
}

export async function crossLinks(limit = 400) {
  const { graph } = getStores();
  const nodes = await graph.query<ViewNode>(
    `MATCH (n)--(m) WHERE m.space <> 'shared'
     WITH n, collect(DISTINCT m.space) AS spaces, count(m) AS degree
     WHERE size(spaces) > 1
     RETURN ${NODE_ID} AS id, ${NODE_LABEL} AS label, labels(n)[0] AS kind, n.space AS space, degree
     ORDER BY degree DESC LIMIT $limit`,
    { limit }
  );
  return withEdges(nodes);
}

export async function labelSearch(space: string, q: string) {
  const { graph } = getStores();
  return graph.query<ViewNode>(
    `MATCH (n) WHERE (n.space = $space OR n.space = 'shared' OR $space = 'all')
       AND toLower(${NODE_LABEL}) CONTAINS toLower($q)
     WITH n, size([(n)--() | 1]) AS degree
     RETURN ${NODE_ID} AS id, ${NODE_LABEL} AS label, labels(n)[0] AS kind, n.space AS space, degree
     ORDER BY degree DESC LIMIT 50`,
    { space, q }
  );
}

const COLLECTIONS: Record<string, string[]> = { reels: ['passages', 'claims'], handbooks: ['chapters'], jobs: [], all: ['passages', 'claims', 'chapters'] };

export async function meaningSearch(space: string, q: string) {
  const { vectors, embed } = getStores();
  const vector = await embed.query(q);
  const out: { collection: string; score: number; text: string; payload: Record<string, unknown> }[] = [];
  for (const c of COLLECTIONS[space] ?? []) {
    const hits = await vectors.search(c, vector, { limit: 8 }).catch(() => []);
    for (const h of hits) out.push({ collection: c, score: h.score, text: String(h.payload.text ?? ''), payload: h.payload });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}
```

Rewrite `app/api/graph/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { spaceGraph, crossLinks, labelSearch, meaningSearch } from '@/lib/knowledge/view';
import { chapterContext } from '@/lib/knowledge/spaces/handbooks';

/** One space per call. `ask` is the meaning search: what the agents would see. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const space = url.searchParams.get('space') ?? 'handbooks';
  const q = url.searchParams.get('q');
  const ask = url.searchParams.get('ask');
  const subject = url.searchParams.get('subject');
  const chapter = url.searchParams.get('chapter');
  try {
    if (subject && chapter) return NextResponse.json(await chapterContext(subject, chapter));
    if (ask) return NextResponse.json({ hits: await meaningSearch(space, ask) });
    if (q) return NextResponse.json({ nodes: await labelSearch(space, q) });
    if (space === 'all') return NextResponse.json(await crossLinks());
    if (space !== 'handbooks' && space !== 'reels' && space !== 'jobs') return NextResponse.json({ error: `no space ${space}` }, { status: 400 });
    return NextResponse.json(await spaceGraph(space));
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 503 });
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/knowledge.view.test.ts && npx tsc --noEmit -p .`
Expected: PASS, typecheck clean. Then `curl "http://localhost:3120/api/graph?space=reels" | head -c 400` shows nodes from the reindex.

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/view.ts app/api/graph/route.ts tests/knowledge.view.test.ts
git commit -m "feat: the graph api serves one space at a time, cross links, and search by meaning"
```

---

### Task 10: The tabbed graph page

**Files:**
- Rewrite: `app/graph/page.tsx`
- Create: `components/graph/GraphCanvas.tsx`
- Modify: `package.json` (cytoscape, cytoscape-fcose, @types/cytoscape)
- Test: `tests/graph.page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/graph?space=…`, `?q=`, `?ask=` from Task 9.
- Produces: `GraphCanvas({ nodes, edges, onSelect })` rendering cytoscape into a `div[data-testid="graph-canvas"]`.

- [ ] **Step 1: Install**

Run: `npm i cytoscape@^3.30.0 cytoscape-fcose@^2.2.0 && npm i -D @types/cytoscape@^3.21.0`

- [ ] **Step 2: Write the failing test**

```tsx
// tests/graph.page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (u.includes('ask=')) return { ok: true, json: async () => ({ hits: [{ collection: 'claims', score: 0.91, text: 'SQLite ships in every phone', payload: {} }] }) } as Response;
    if (u.includes('space=jobs')) return { ok: true, json: async () => ({ nodes: [{ id: 'Week:2026-W46', label: '2026-W46', kind: 'Week', space: 'jobs', degree: 4 }], edges: [] }) } as Response;
    return { ok: true, json: async () => ({ nodes: [{ id: 'Reel:x', label: 'X', kind: 'Reel', space: 'reels', degree: 1 }], edges: [] }) } as Response;
  });
  // cytoscape needs a real layout engine; in jsdom the canvas is a stub.
  vi.mock('@/components/graph/GraphCanvas', () => ({ default: ({ nodes }: { nodes: { id: string }[] }) => <div data-testid="graph-canvas">{nodes.map((n) => n.id).join(',')}</div> }));
});

describe('the graph page', () => {
  it('has four tabs, loads the chosen space, and shows meaning hits', async () => {
    const Page = (await import('@/app/graph/page')).default;
    render(<Page />);
    expect(screen.getByRole('tab', { name: 'Handbooks' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Reels' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Jobs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'All' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Jobs' }));
    await waitFor(() => expect(screen.getByTestId('graph-canvas').textContent).toContain('Week:2026-W46'));
    fireEvent.change(screen.getByPlaceholderText('ask by meaning…'), { target: { value: 'sqlite phones' } });
    fireEvent.keyDown(screen.getByPlaceholderText('ask by meaning…'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/SQLite ships in every phone/)).toBeTruthy());
  });

  it('says the store is down instead of showing an empty graph', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, json: async () => ({ error: 'ECONNREFUSED 127.0.0.1:3124' }) }) as Response);
    const Page = (await import('@/app/graph/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/knowledge graph is not answering/i)).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `npx vitest run tests/graph.page.test.tsx`
Expected: FAIL, no tabs.

- [ ] **Step 4: Write the canvas and the page**

```tsx
// components/graph/GraphCanvas.tsx
'use client';
import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { ViewEdge, ViewNode } from '@/lib/knowledge/view';

cytoscape.use(fcose);

const COLOUR: Record<string, string> = {
  Subject: '#c02a58', Chapter: '#3ec5ff', Topic: '#3ddc97', Source: '#f2a93b', Domain: '#b58900', Claim: '#9d7cff',
  Reel: '#ff6f94', ScriptLine: '#8fb3ff', Week: '#2fb7a1', Employer: '#e0b34a', Function: '#7ab0ff', City: '#a0d468', WorkMode: '#c9c9c9',
};

/** cytoscape owns the DOM inside the div; React only hands it data. */
export default function GraphCanvas({ nodes, edges, onSelect }: { nodes: ViewNode[]; edges: ViewEdge[]; onSelect?: (n: ViewNode) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...nodes.map((n) => ({ data: { id: n.id, label: n.label, kind: n.kind, degree: n.degree, node: n } })),
        ...edges.map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target, rel: e.rel } })),
      ],
      style: [
        { selector: 'node', style: { 'background-color': (el: cytoscape.NodeSingular) => COLOUR[el.data('kind')] ?? '#888', label: 'data(label)', 'font-size': 9, width: (el: cytoscape.NodeSingular) => 12 + Math.min(el.data('degree'), 30), height: (el: cytoscape.NodeSingular) => 12 + Math.min(el.data('degree'), 30), 'text-valign': 'bottom', 'text-margin-y': 4, color: '#666' } },
        { selector: 'edge', style: { width: 1, 'line-color': '#bbb', 'curve-style': 'haystack', opacity: 0.6 } },
        { selector: ':selected', style: { 'border-width': 3, 'border-color': '#c02a58' } },
      ],
      layout: { name: 'fcose', animate: false, quality: 'default' } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
    });
    cy.on('tap', 'node', (ev) => onSelect?.(ev.target.data('node') as ViewNode));
    return () => { cy.destroy(); };
  }, [nodes, edges, onSelect]);
  return <div ref={ref} data-testid="graph-canvas" style={{ width: '100%', height: 560, background: 'var(--ant-color-bg-container, #fff)', borderRadius: 8 }} />;
}
```

```tsx
// app/graph/page.tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Card, Input, List, Tabs, Tag, Typography } from 'antd';
import GraphCanvas from '@/components/graph/GraphCanvas';
import type { ViewEdge, ViewNode } from '@/lib/knowledge/view';

/**
 * One page, four tabs, one space at a time. The second search box is the meaning search
 * the research agents use, shown here so what they would see is never a mystery.
 */

type SpaceKey = 'handbooks' | 'reels' | 'jobs' | 'all';
type Hit = { collection: string; score: number; text: string; payload: Record<string, unknown> };

export default function GraphPage() {
  const router = useRouter();
  const [space, setSpace] = useState<SpaceKey>('handbooks');
  const [nodes, setNodes] = useState<ViewNode[]>([]);
  const [edges, setEdges] = useState<ViewEdge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ViewNode | null>(null);
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [found, setFound] = useState<ViewNode[]>([]);

  const load = useCallback(async (s: SpaceKey) => {
    const r = await fetch(`/api/graph?space=${s}`, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) { setError(d.error ?? `answered ${r.status}`); setNodes([]); setEdges([]); return; }
    setError(null); setNodes(d.nodes ?? []); setEdges(d.edges ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(space);
  }, [space, load]);

  const search = async () => {
    if (!q) { setFound([]); return; }
    const r = await fetch(`/api/graph?space=${space}&q=${encodeURIComponent(q)}`);
    const d = await r.json();
    setFound(d.nodes ?? []);
  };
  const askByMeaning = async () => {
    if (!ask) { setHits([]); return; }
    const r = await fetch(`/api/graph?space=${space}&ask=${encodeURIComponent(ask)}`);
    const d = await r.json();
    setHits(d.hits ?? []);
  };

  return (
    <div>
      <Typography.Title level={4}>Knowledge graph</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginTop: -6 }}>
        One graph, one space per category, shared topics and sources between them. The research agents read the same stores.
      </Typography.Paragraph>

      {error && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title="The knowledge graph is not answering"
          description={<span>{error}. Start Neo4j from <a onClick={() => router.push('/plugins')}>Plugins</a>.</span>} />
      )}

      <Tabs
        activeKey={space}
        onChange={(k) => { setSpace(k as SpaceKey); setSelected(null); setFound([]); setHits([]); }}
        items={[
          { key: 'handbooks', label: 'Handbooks' },
          { key: 'reels', label: 'Reels' },
          { key: 'jobs', label: 'Jobs' },
          { key: 'all', label: 'All' },
        ]}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
        <GraphCanvas nodes={nodes} edges={edges} onSelect={setSelected} />
        <div style={{ display: 'grid', gap: 12 }}>
          <Input.Search placeholder="search labels…" value={q} onChange={(e) => setQ(e.target.value)} onSearch={() => void search()} />
          {found.length > 0 && (
            <List size="small" dataSource={found} renderItem={(n) => <List.Item onClick={() => setSelected(n)} style={{ cursor: 'pointer' }}><Tag>{n.kind}</Tag>{n.label}</List.Item>} />
          )}
          <Input placeholder="ask by meaning…" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void askByMeaning(); }} />
          {hits.length > 0 && (
            <List size="small" dataSource={hits} renderItem={(h) => <List.Item><Tag>{h.collection}</Tag><span style={{ fontVariantNumeric: 'tabular-nums', marginRight: 8 }}>{h.score.toFixed(2)}</span>{h.text.slice(0, 160)}</List.Item>} />
          )}
          {selected && (
            <Card size="small" title={<span><Tag>{selected.kind}</Tag>{selected.label}</span>}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{selected.id} · degree {selected.degree} · space {selected.space}</Typography.Text>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run, expect pass; then look**

Run: `npx vitest run tests/graph.page.test.tsx && npx tsc --noEmit -p . && npx eslint app/graph components/graph`
Expected: PASS, clean. Open `http://localhost:3120/graph`, click each tab, see nodes; type "sqlite" in ask by meaning and see claims and passages from the reindex.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app/graph/page.tsx components/graph/GraphCanvas.tsx tests/graph.page.test.tsx
git commit -m "feat: the knowledge graph page has a tab per space and a search by meaning"
```

---

### Task 11: Docs, port map, and the handbook line

**Files:**
- Modify: `C:\Users\sathwik\projects\_devkit\PORTMAP.md` (four rows in the live allocation table and the studio's block), `docs/STATE.md`, `docs/handbooks/reels-engine-handbook.html` (section 19 status from "designed" to "built", and the third-parties tag from `designed` to `new`)

- [ ] **Step 1: Port map rows**

Add under Live allocation:

```
| 3124  | instastudio       | neo4j bolt           |
| 3125  | instastudio       | neo4j browser        |
| 3126  | instastudio       | qdrant http          |
| 3127  | instastudio       | qdrant grpc          |
```
and in the Allocation rule table a row `| instastudio | 3120-3127, 25100, 25103, 25180, 26100 |` (or extend the existing row if one exists).

- [ ] **Step 2: STATE.md**

Add a "Knowledge layer" block: compose command, `npm run reindex:knowledge -- --wipe`, the four ports, `D:\iolar`, and that tests never touch the real stores.

- [ ] **Step 3: Handbook**

In `docs/handbooks/reels-engine-handbook.html` change the lede of section 19 from "Designed 2 September, implementation next." to "Built 2 September." and the `designed` tag in the third-parties table to `new`. Republish the artifact from the same file (the Artifact tool with the existing URL).

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md docs/handbooks/reels-engine-handbook.html
git commit -m "docs: the knowledge layer is built, and the port map knows its four ports"
```
(`PORTMAP.md` lives outside this repo; commit it in `_devkit` if that is a repo, otherwise leave the edit in place.)

---

## Self-review

**Spec coverage.** Stores and deployment → Task 1, 8. Settings → Task 1. Graph model handbooks → Task 4; reels → Task 5; jobs → Task 6; cross-links → Task 9. Vector collections passages, claims → Task 5; `scripts`, `chapters` are phase 2/3, out of scope here by the spec's own phasing. Write path and callers → Tasks 4, 5, 6. Reindex → Task 7. Page → Tasks 9, 10. Migration → Task 4 (delete, drop) and Task 7 (rebuild). Testing → fakes in Task 2, live opt-in in Task 3, idempotence cases in Tasks 4, 5, 6. Risks: heap cap in Task 1 compose; embedding cache in Task 3; board down in Tasks 6, 7. Agent recall → companion plan. Card counts (node and point) → deferred to the companion plan and said so in Task 8.

**Placeholders.** None. Task 7 tells the engineer to confirm the exact `lib/store.ts` reader names before writing; the test covers the reels branch which uses names this plan defines.

**Type consistency.** `GraphStore.mergeNode(label, key, props)`, `mergeEdge(from, rel, to, props?)`, `query`, `wipe`, `close` used identically in fake, neo4j, spaces. `VectorStore.ensure/upsert/search/deleteWhere/count` identical in fake, qdrant, reels space, view. `Embedder.docs/query/dims` identical in fake, embed, reels, view. `pointId(space, kind, key)` used with `'reels','passage'` and `'shared','claim'`. `WeekView` defined in Task 6 and consumed by reindex in Task 7. `ViewNode`/`ViewEdge` defined in Task 9, consumed in Task 10.
