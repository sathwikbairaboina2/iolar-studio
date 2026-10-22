// npx tsx scripts/launch-watch.mts
//
// Runs the daily reference check once, now: reads the channels tracked in instascraper (INSTASCRAPER_URL, default
// http://localhost:3000/api), classifies new reels, and files the launches in data/launch/inbox/. It uses the real Claude
// CLI and whisper, so it spends model time; run it deliberately.
import { realWatchDeps, runWatch } from '../lib/launch/watch';

runWatch(await realWatchDeps()).then(
  (r) => { console.log(`checked ${r.checked}, launches ${r.launches}, added ${r.added.join(', ') || 'none'}${r.skipped ? `, skipped: ${r.skipped}` : ''}`); process.exit(0); },
  (err) => { console.error(err instanceof Error ? err.message : err); process.exit(2); },
);
