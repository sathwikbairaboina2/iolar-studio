/**
 * End-to-end smoke of the studio's half: write a document, fold it, render it through the
 * templates service, and confirm the mp4 landed beside it.
 *
 * Needs the service up on 26200. Run from the repo root:
 *   npx tsx scripts/verify-explainer.mts
 */
import { promises as fs } from 'fs';
import { foldDoc, totalSeconds } from '../lib/explainer/schema';
import { blankDoc, get, list, remove, save } from '../lib/explainer/store';
import { contract } from '../lib/explainer/service';
import * as renders from '../lib/explainer/renders';
import { explainerRenderMp4 } from '../lib/paths';

const SLUG = 'verify-explainer-smoke';

async function main() {
  const spec = await contract();
  if (!spec) throw new Error('the templates service is not answering on 26200');
  console.log(`contract   themes=${spec.themes.join(',')}`);
  console.log(`           mutations=${Object.keys(spec.mutations).join(',')}`);

  const doc = blankDoc('Studio bridge smoke test', spec.themes[0]);
  await save(SLUG, doc);
  const back = await get(SLUG);
  if (!back) throw new Error('saved it and could not read it back');
  console.log(`saved      ${SLUG}  ${back.beats.length} beats  ${totalSeconds(back)}s`);

  const steps = foldDoc(back);
  console.log(`folded     ${steps.length} steps, last board has ${steps[steps.length - 1].scene.rows.length} rows`);

  const listed = (await list()).find((e) => e.slug === SLUG);
  if (!listed) throw new Error('it does not appear in the list');
  console.log(`listed     "${listed.title}"  ${listed.seconds}s  rendered=${listed.renderedAt ? 'yes' : 'no'}`);

  console.log('rendering  (submitted as a job, polled here the way the page polls it)');
  const submitted = await renders.start(SLUG, back);
  let log = await renders.read(SLUG, back);
  for (let n = 0; log.live && n < 600; n += 1) {
    await new Promise((r) => setTimeout(r, 1200));
    log = await renders.poll(SLUG);
  }
  const record = log.renders.find((r) => r.id === submitted.id);
  if (!record || record.state !== 'done') throw new Error(`render failed: ${record?.error ?? 'it never finished'}`);
  const stat = await fs.stat(explainerRenderMp4(SLUG, record.id));
  console.log(`rendered   ${record.seconds}s  ${(stat.size / 1024).toFixed(0)}kb  job ${record.id}`);

  await remove(SLUG);
  console.log(`cleaned    removed ${SLUG}`);
  console.log('\nOK — the studio can author, fold, list and render an explainer.');
}

main().catch((err) => {
  console.error(`\nFAILED  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
