// Applies the fit pass repeatedly until every page needs <= 104% of a sheet.
const slug = process.argv[2] ?? 'python-data-structures';
const base = 'http://localhost:3100/api/paperbook/' + slug;
const MAX_ROUNDS = Number(process.argv[3] ?? 3);

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
