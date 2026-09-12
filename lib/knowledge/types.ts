/**
 * The two stores behind the knowledge layer, as interfaces.
 *
 * Writers only ever merge; readers run Cypher or a vector search. Everything that
 * touches Neo4j or Qdrant goes through these, so every writer and reader is tested
 * against the in-memory fake in fake.ts and the real drivers are covered once, by the
 * opt-in live test.
 */

export type Space = 'handbooks' | 'reels' | 'jobs' | 'explainers' | 'shared';
export const SPACES: Space[] = ['handbooks', 'reels', 'jobs', 'explainers', 'shared'];
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
