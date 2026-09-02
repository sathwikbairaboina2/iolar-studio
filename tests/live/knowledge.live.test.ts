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
