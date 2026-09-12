// npx tsx scripts/reindex-knowledge.mts [--space handbooks|reels|jobs|explainers]... [--wipe]
// Rebuilds Neo4j and Qdrant from data/ and the jobs board. Safe to re-run; --wipe first
// turns a top-up into a rebuild.
import { reindexKnowledge } from '../lib/knowledge/reindex';
import type { Space } from '../lib/knowledge/types';

const args = process.argv.slice(2);
const wipe = args.includes('--wipe');
const spaces = args.flatMap((a, i) => (a === '--space' ? [args[i + 1] as Space] : []));
const out = await reindexKnowledge({
  spaces: spaces.length ? spaces : ['handbooks', 'reels', 'jobs', 'explainers'],
  wipe,
  log: console.log,
});
console.log(out);
process.exit(0);
