import { beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';

// No test ever talks to a real store. The live test opts out by constructing drivers itself.
beforeEach(() => {
  useStoresForTests({ graph: new FakeGraph(), vectors: new FakeVectors(), embed: new FakeEmbed() });
});
