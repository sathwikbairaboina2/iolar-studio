// Restores book points a chapter no longer covers, then re-renders the part that grew.
import { chapterGaps, repairCoverage } from '../lib/ai/repair';
import { closeBrowser } from '../lib/renderer/capture';

const BASE = 'http://localhost:3100/api/handbooks';

for (const key of process.argv.slice(2)) {
  const [subject, chapter] = key.split('/');
  try {
    const before = await chapterGaps(subject, chapter);
    if (!before.length) { console.log(`· ${key}: already complete`); continue; }

    const r = await repairCoverage(subject, chapter);
    if (!r) { console.log(`· ${key}: nothing to repair`); continue; }
    console.log(`↑ ${key}: recovered ${r.recovered.length}, ${r.missingBefore} -> ${r.missingAfter} missing (part ${r.part})`);

    const res = await fetch(`${BASE}/${subject}/${chapter}/parts/${r.part}/render`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    console.log(`   rendered part ${r.part}: ${body.results.map((x: any) => x.fillPct).join(', ')}`);
  } catch (err) {
    console.log(`✗ ${key}: ${String(err).slice(0, 160)}`);
  }
}
await closeBrowser();
