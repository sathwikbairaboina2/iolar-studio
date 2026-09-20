/**
 * Reads every review.json the campaign produced and acts on it.
 *
 * Cosmetic findings (visual, brand) are applied and the part re-rendered. Editorial ones
 * (facts, pedagogy) are printed as a numbered proposal, and applied only with --apply <key>.
 * Minors are counted and left alone.
 *
 *   npx tsx scripts/triage.mts [--subject <slug>] [--auto] [--apply <key>]
 */
import { listSubjects, listChapters, listParts, loadPost, savePost } from '../lib/store';
import { loadReview } from '../lib/verify/review';
import { disposition, triageOrder, requestFor } from '../lib/verify/triage';
import { revisePost } from '../lib/ai/revise';
import { diffPosts } from '../lib/ai/diff';
import type { Finding } from '../lib/verify/gates';

const args = process.argv.slice(2);
const only = args.includes('--subject') ? args[args.indexOf('--subject') + 1] : null;
const applyKey = args.includes('--apply') ? args[args.indexOf('--apply') + 1] : null;
const auto = args.includes('--auto');

type Item = { key: string; subject: string; chapter: string; part: number; finding: Finding };

async function collect(): Promise<Item[]> {
  const items: Item[] = [];
  for (const s of (await listSubjects()).filter((x) => !only || x.slug === only)) {
    for (const c of await listChapters(s.slug)) {
      for (const p of await listParts(s.slug, c.slug)) {
        const review = await loadReview(s.slug, c.slug, p);
        if (!review) continue;
        for (const [i, finding] of triageOrder(review.findings).entries()) {
          items.push({ key: `${s.slug}/${c.slug}/${p}#${i}`, subject: s.slug, chapter: c.slug, part: p, finding });
        }
      }
    }
  }
  return items;
}

async function applyOne(item: Item) {
  const before = await loadPost(item.subject, item.chapter, item.part);
  const after = await revisePost(before, requestFor(item.finding), 'slide', Math.max(item.finding.page - 1, 0));
  const diff = diffPosts(before, after);
  await savePost(item.subject, item.chapter, item.part, after);
  console.log(`applied ${item.key}: ${diff.length} slide(s) changed`);
}

async function run() {
  const items = await collect();
  const buckets = { auto: [] as Item[], approve: [] as Item[], skip: [] as Item[] };
  for (const it of items) buckets[disposition(it.finding)].push(it);

  console.log(
    `${items.length} finding(s): ${buckets.auto.length} auto, ` +
    `${buckets.approve.length} need approval, ${buckets.skip.length} skipped`
  );

  if (applyKey) {
    const item = items.find((i) => i.key === applyKey);
    if (!item) { console.error(`no finding with key ${applyKey}`); process.exit(1); }
    await applyOne(item);
    return;
  }

  if (auto) {
    for (const it of buckets.auto) await applyOne(it);
    console.log('re-render the touched parts with: npx tsx scripts/quality-campaign.mts');
    return;
  }

  for (const it of buckets.approve) {
    console.log(`\n[${it.key}] ${it.finding.severity} ${it.finding.pass} p${it.finding.page}`);
    console.log(`  ${it.finding.summary}`);
    console.log(`  evidence: ${it.finding.evidence}`);
    console.log(`  fix: ${it.finding.fix}`);
    console.log(`  apply with: npx tsx scripts/triage.mts --apply ${it.key}`);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
