// End-to-end: create subject -> chapter -> book from topic -> pages -> render.
const BASE = 'http://localhost:3100/api/handbooks';

// A dropped connection mid-run used to abort a chapter that was minutes of AI work
// from finishing, so network-level failures get a few attempts.
const RETRY = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const json = async (url, init) => {
  let r;
  for (let attempt = 1; ; attempt++) {
    try { r = await fetch(url, init); break; }
    catch (err) {
      if (attempt >= RETRY) throw new Error(`${url} failed after ${RETRY} attempts: ${err}`);
      console.log(`  retry ${attempt}/${RETRY - 1} after ${String(err).slice(0, 60)}`);
      await sleep(1000 * attempt);
    }
  }
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${r.status} ${b.error ?? ''}`);
  return b;
};
const post = (url, body) =>
  json(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

const SUBJECTS = [
  { slug: 'sql', name: 'SQL', emoji: '🗄️', chapter: 'window-functions', title: 'Window Functions',
    topic: 'SQL window functions: OVER, PARTITION BY, ranking, running totals, frames' },
  { slug: 'system-design', name: 'System Design', emoji: '⚙️', chapter: 'caching', title: 'Caching Strategies',
    topic: 'Caching in system design: cache-aside, write-through, TTL, eviction policies, invalidation' },
];

for (const s of SUBJECTS) {
  console.log(`\n=== ${s.emoji} ${s.name} / ${s.title} ===`);

  await post(BASE, { slug: s.slug, name: s.name, emoji: s.emoji }).catch((e) => console.log('  subject:', e.message));
  await post(`${BASE}/${s.slug}`, { slug: s.chapter, title: s.title }).catch((e) => console.log('  chapter:', e.message));

  const chapters = await json(`${BASE}/${s.slug}`);
  console.log('  chapters:', chapters.chapters.map((c) => `${c.slug}(${c.parts}p)`).join(', '));

  console.log('  building book from topic…');
  const { book } = await post(`${BASE}/${s.slug}/${s.chapter}/book`, {
    action: 'generate', mode: 'topic', topic: s.topic,
  });
  console.log(`  book: ${book.chapters.length} chapters, ${book.chapters.reduce((n, c) => n + c.points.length, 0)} points`);

  console.log('  writing pages from book…');
  const plan = await post(`${BASE}/${s.slug}/${s.chapter}/parts/1/plan`, {});
  console.log(`  pages: ${plan.slides.length}, blocks: ${plan.slides.reduce((n, x) => n + x.blocks.length, 0)}`);

  console.log('  rendering…');
  const render = await post(`${BASE}/${s.slug}/${s.chapter}/parts/1/render`, {});
  const fills = render.results.map((r) => r.fillPct);
  const mean = Math.round(fills.reduce((a, b) => a + b, 0) / fills.length);
  console.log(`  RESULT ${render.slides} pages | fill mean ${mean} | overflow max ${Math.max(...render.results.map((r) => r.overflowPx))}`);
  console.log('  per page:', fills.join(', '), render.followUp ? `| followUp part ${render.followUp.part}` : '');
}

const all = await json(BASE);
console.log('\n=== subjects now ===');
for (const s of all.subjects) console.log(` ${s.emoji} ${s.name}: ${s.chapters} chapters, ${s.pages} pages`);
