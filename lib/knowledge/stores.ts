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
