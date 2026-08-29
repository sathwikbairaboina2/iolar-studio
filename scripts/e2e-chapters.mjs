// End-to-end: several chapters inside existing subjects, then verify listings and the graph.
const BASE = 'http://localhost:3100/api/handbooks';

const json = async (url, init) => {
  const r = await fetch(url, init);
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${r.status} ${b.error ?? ''}`);
  return b;
};
const post = (url, body) =>
  json(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

const CHAPTERS = [
  { subject: 'python', slug: 'decorators', title: 'Decorators & Closures',
    topic: 'Python decorators and closures: wrapping functions, functools.wraps, arguments, common uses' },
  { subject: 'python', slug: 'generators', title: 'Iterators & Generators',
    topic: 'Python iterators and generators: iter/next protocol, yield, lazy evaluation, generator expressions' },
  { subject: 'sql', slug: 'joins', title: 'Joins & Set Operations',
    topic: 'SQL joins: inner, left, right, full, cross, self joins, and set operations union/intersect/except' },
  { subject: 'system-design', slug: 'rate-limiting', title: 'Rate Limiting',
    topic: 'Rate limiting in system design: token bucket, leaky bucket, sliding window, distributed limits' },
];

for (const c of CHAPTERS) {
  console.log(`\n=== ${c.subject} / ${c.title} ===`);
  await post(`${BASE}/${c.subject}`, { slug: c.slug, title: c.title }).catch((e) => console.log('  chapter:', e.message));

  const { book } = await post(`${BASE}/${c.subject}/${c.slug}/book`, {
    action: 'generate', mode: 'topic', topic: c.topic,
  });
  const points = book.chapters.reduce((n, x) => n + x.points.length, 0);

  const plan = await post(`${BASE}/${c.subject}/${c.slug}/parts/1/plan`, {});
  const render = await post(`${BASE}/${c.subject}/${c.slug}/parts/1/render`, {});
  const fills = render.results.map((r) => r.fillPct);
  const mean = Math.round(fills.reduce((a, b) => a + b, 0) / fills.length);

  console.log(`  book ${book.chapters.length}ch/${points}pts -> ${plan.slides.length} pages authored`);
  console.log(`  RESULT ${render.slides} pages | fill ${mean}% | overflow ${Math.max(...render.results.map((r) => r.overflowPx))}` +
    (render.followUp ? ` | followUp part ${render.followUp.part}` : ''));
}

console.log('\n=== subject listings ===');
const all = await json(BASE);
for (const s of all.subjects) {
  const { chapters } = await json(`${BASE}/${s.slug}`);
  console.log(` ${s.emoji} ${s.name}: ${chapters.length} chapters`);
  for (const c of chapters) {
    console.log(`   - ${c.title}: ${c.parts} part(s), ${c.points} points, ${c.pages} pages, ${c.avgFill}% fill, ${c.status}`);
  }
}
