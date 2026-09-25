/**
 * Reads every review.json the campaign produced and acts on it.
 *
 * Cosmetic findings (visual, brand) are applied and the part re-rendered. Editorial ones
 * (facts, pedagogy) are printed as a proposal; --apply <key> previews the revision and
 * --apply <key> --write commits it.
 * Minors are counted and left alone.
 *
 *   npx tsx scripts/triage.mts [--subject <slug>] [--auto] [--apply <key> [--write]]
 */
import { listSubjects, listChapters, listParts, loadPost, savePost } from '../lib/store';
import { loadReview } from '../lib/verify/review';
import { disposition, triageOrder, requestFor, findingKey } from '../lib/verify/triage';
import { revisePost } from '../lib/ai/revise';
import { applyMoves, isPositional, proposeMoves, strandedHeadingMove } from '../lib/ai/moves';
import { diffPosts } from '../lib/ai/diff';
import type { Finding } from '../lib/verify/gates';
import type { Post } from '../lib/schema';

const args = process.argv.slice(2);
const only = args.includes('--subject') ? args[args.indexOf('--subject') + 1] : null;
const applyKey = args.includes('--apply') ? args[args.indexOf('--apply') + 1] : null;
const auto = args.includes('--auto');
const write = args.includes('--write');

type Item = { key: string; subject: string; chapter: string; part: number; finding: Finding };

async function collect(): Promise<Item[]> {
  const items: Item[] = [];
  for (const s of (await listSubjects()).filter((x) => !only || x.slug === only)) {
    for (const c of await listChapters(s.slug)) {
      for (const p of await listParts(s.slug, c.slug)) {
        const review = await loadReview(s.slug, c.slug, p);
        if (!review) continue;
        for (const [i, finding] of triageOrder(review.findings).entries()) {
          void i;
          items.push({
            key: `${s.slug}/${c.slug}/${p}#${findingKey(finding)}`,
            subject: s.slug, chapter: c.slug, part: p, finding,
          });
        }
      }
    }
  }
  return items;
}

/**
 * The edit a finding calls for. A stranded heading is moved by rule; a finding about order is
 * fixed with a checked move plan, which cannot drop content the way a page rewrite can; the
 * rest are rewritten by revisePost. Null means the finding no longer applies.
 */
async function fixFor(post: Post, f: Finding): Promise<Post | null> {
  if (f.rule === 'heading.stranded') {
    const move = strandedHeadingMove(post, f);
    return move ? applyMoves(post, [move]) : null;
  }
  if (isPositional(f)) {
    const { moves, post: moved } = await proposeMoves(post, f);
    if (moves.length) return moved;
    // An empty plan: the model judged it could not be fixed by moving, so it is rewritten.
  }
  return revisePost(post, requestFor(f), 'slide', Math.max(f.page - 1, 0));
}

/**
 * Runs the revision and shows what it would change. Saves ONLY when `write` is set.
 *
 * Approving a finding is not the same as approving the prose a model wrote to fix it, and
 * the editorial queue is thousands long — sight-unseen application is exactly the risk the
 * approval gate exists to prevent. So `--apply` previews and `--apply --write` commits.
 */
async function applyOne(item: Item, write: boolean) {
  const before = await loadPost(item.subject, item.chapter, item.part);
  const after = await fixFor(before, item.finding);
  if (!after) { console.log(`\n${item.key}: already fixed — nothing to do`); return; }
  const diff = diffPosts(before, after);

  console.log(`\n${item.key}: ${diff.length} slide(s) would change`);
  for (const sd of diff) console.log(`  ${JSON.stringify(sd).slice(0, 400)}`);

  if (!write) {
    console.log(`\nPREVIEW ONLY — nothing written. Commit it with:`);
    console.log(`  npx tsx scripts/triage.mts --apply ${item.key} --write`);
    return;
  }
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
    await applyOne(item, write);
    return;
  }

  if (auto) {
    for (const it of buckets.auto) await applyOne(it, true);
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
