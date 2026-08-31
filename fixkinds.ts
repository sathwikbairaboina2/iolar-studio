import { coerceKinds } from './lib/reel/build/bridge';
import { loadReel, saveReel } from './lib/reel/store';
import * as research from './lib/reel/research/store';

const slug = process.argv[2];
(async () => {
  const reel = await loadReel(slug);
  const script = await research.readScript(slug);
  const beats = coerceKinds(script.lines, reel.beats);
  await saveReel(slug, { ...reel, beats });
  const counts: Record<string, number> = {};
  for (const b of beats) counts[b.shot.kind] = (counts[b.shot.kind] ?? 0) + 1;
  console.log(slug, JSON.stringify(counts));
})();
