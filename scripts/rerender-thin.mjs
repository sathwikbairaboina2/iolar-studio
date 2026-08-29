// Re-renders every part that has a page under 70% fill, so tail balancing applies.
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';

const BASE = 'http://localhost:3100/api/handbooks';
const ROOT = 'data/handbooks';
const RETRY = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (url) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      return b;
    } catch (err) {
      if (attempt >= RETRY) throw err;
      await sleep(1000 * attempt);
    }
  }
};

const targets = [];
for (const subject of readdirSync(ROOT)) {
  const sd = path.join(ROOT, subject);
  if (!statSync(sd).isDirectory()) continue;
  for (const chapter of readdirSync(sd)) {
    const pd = path.join(sd, chapter, 'parts');
    if (!existsSync(pd)) continue;
    for (const part of readdirSync(pd)) {
      const rep = path.join(pd, part, 'renders', 'render-report.json');
      if (!existsSync(rep)) continue;
      const report = JSON.parse(readFileSync(rep, 'utf8'));
      const fills = Object.values(report).map((v) => v.fillPct).filter((v) => typeof v === 'number');
      if (fills.some((f) => f < 70)) targets.push({ subject, chapter, part: Number(part), before: fills });
    }
  }
}

console.log(`${targets.length} parts have a page under 70% fill\n`);
let improved = 0;

for (const t of targets) {
  const tag = `${t.subject}/${t.chapter} part ${t.part}`;
  try {
    const r = await post(`${BASE}/${t.subject}/${t.chapter}/parts/${t.part}/render`);
    const after = r.results.map((x) => x.fillPct);
    const worstBefore = Math.min(...t.before);
    const worstAfter = Math.min(...after);
    if (worstAfter > worstBefore) improved += 1;
    console.log(`${worstAfter > worstBefore ? '↑' : '·'} ${tag}: worst ${worstBefore}% -> ${worstAfter}%  [${after.join(', ')}]`);
  } catch (err) {
    console.log(`✗ ${tag}: ${String(err).slice(0, 100)}`);
  }
}

console.log(`\n${improved}/${targets.length} parts improved their worst page`);
