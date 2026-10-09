import { describe, it, expect } from 'vitest';
import { resolveIcon } from '@/lib/renderer/icons';

describe('generic concept words never resolve to an unrelated brand logo', () => {
  // Before the fix the fuzzy name search sent "Index" to Podcast Index, "Cache" to Cachet,
  // "Data" to Data.ai and "Query" to jQuery: a cover strip of concepts became a row of vendors.
  it.each(['Index', 'Indexing', 'Cache', 'Caching', 'Data', 'Query', 'Queries', 'Storage', 'Replication', 'Sharding', 'Transactions', 'Locking', 'Latency', 'Joins'])(
    '%s draws a generic icon',
    (word) => {
      const r = resolveIcon(word);
      expect(r, word).not.toBeNull();
      expect(r?.source, word).toBe('ui');
    }
  );

  it('real products still find their brand mark', () => {
    expect(resolveIcon('PostgreSQL')?.source).toBe('brand');
    expect(resolveIcon('Redis')?.source).toBe('brand');
    expect(resolveIcon('Kafka')?.source).toBe('brand');
    expect(resolveIcon('Docker')?.source).toBe('brand');
  });
});
