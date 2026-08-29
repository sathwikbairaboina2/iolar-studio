// Applies the fit pass repeatedly until every page needs <= 104% of a sheet.
const slug = process.argv[2] ?? 'python-data-structures';
const base = 'http://localhost:3100/api/paperbook/' + slug;
const MAX_ROUNDS = Number(process.argv[3] ?? 3);

const json = async (url, init) => {
  const r = await fetch(url, init);
  const b = await r.json();
  if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
  return b;
};

for (let round = 1; round <= MAX_ROUNDS; round++) {
  const { proposal, before } = await json(base + '/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'fit' }),
  });

  const worst = Math.max(...before.map((m) => m.neededPct));
  console.log(`round ${round}: needed% = [${before.map((m) => m.neededPct).join(', ')}] worst ${worst}`);

  if (worst <= 99) {
    console.log('converged — every page fits');
    break;
  }

  await json(base, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(proposal),
  });
  const blocks = proposal.slides.reduce((n, s) => n + s.blocks.length, 0);
  console.log(`  applied: ${proposal.slides.length} slides, ${blocks} blocks`);
}

const render = await json(base + '/render', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({}),
});
const fills = render.results.map((r) => r.fillPct);
const mean = Math.round(fills.reduce((a, b) => a + b, 0) / fills.length);
console.log(`FINAL: ${render.slides} pages, split=${render.split}, fill mean ${mean}, min ${Math.min(...fills)}, max ${Math.max(...fills)}`);
console.log('per page:', fills.join(', '));
