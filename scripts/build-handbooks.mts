/**
 * Builds whole handbooks from a spec: subject → chapters → book → pages → polished render →
 * review, the same stages the studio runs one button at a time.
 *
 *   npx tsx scripts/build-handbooks.mts <spec.json> [--subject <slug>] [--skip-review]
 *
 * `--skip-review` leaves the review out: it always runs on Claude, whatever the provider.
 *
 * The spec is `[{ slug, name, emoji?, description?, chapters: [{ slug, title, topic, category? }] }]`; category is a handbook category id (default handbook).
 * Every stage is recorded in data/.build-state.json the moment it finishes, so a re-run picks
 * up at the first stage not done. A crash costs one stage.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { createSubject, createChapter, listParts, loadSubject } from '../lib/store';
import type { CategoryId } from '../lib/handbookCategories';
import { bookFromTopic } from '../lib/ai/book';
import { planPagesFromBook } from '../lib/ai/pages';
import { fitPlannedPages } from '../lib/ai/plan';
import { reviewPart } from '../lib/verify/review';
import { closeBrowser } from '../lib/renderer/capture';
import { dataRoot } from '../lib/paths';

type Spec = { slug: string; name: string; emoji?: string; description?: string; chapters: { slug: string; title: string; topic: string; category?: CategoryId }[] }[];

const args = process.argv.slice(2);
const only = args.includes('--subject') ? args[args.indexOf('--subject') + 1] : null;
const skipReview = args.includes('--skip-review');

const stateFile = () => path.join(dataRoot(), '.build-state.json');
const started = Date.now();
const note = (msg: string) => console.log(`[build ${new Date().toISOString().slice(11, 19)} +${Math.round((Date.now() - started) / 60000)}m] ${msg}`);

// A run that dies must say how.
process.on('exit', (code) => note(`process exiting with code ${code}`));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, () => { note(`killed by ${sig}`); process.exit(130); });
process.on('uncaughtException', (err) => { note(`CRASHED: ${err.stack ?? err}`); process.exit(1); });
process.on('unhandledRejection', (err) => { note(`CRASHED (unhandled rejection): ${err instanceof Error ? err.stack : err}`); process.exit(1); });

async function loadState(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readFile(stateFile(), 'utf8')); } catch { return {}; }
}

async function stage(state: Record<string, string>, key: string, what: () => Promise<string>) {
  if (state[key]) return;
  const t = Date.now();
  const detail = await what();
  state[key] = new Date().toISOString();
  // Parallel runs share the file; merge with what is on disk so no run drops another's stages.
  await fs.writeFile(stateFile(), JSON.stringify({ ...(await loadState()), [key]: state[key] }, null, 2));
  note(`${key} done in ${Math.round((Date.now() - t) / 1000)}s${detail ? ` — ${detail}` : ''}`);
}

/**
 * The render route in-process with polish on; follow-ups are polished by the caller. Per-slide,
 * as the studio's auto-fill runs it: a bulk densify is kept whenever the emptiest page got no
 * worse, which left spill pages 13-40% full.
 */
async function polish(subject: string, chapter: string, part: number) {
  const route = await import('../app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
  const res = await route.POST(
    new Request('http://build.local/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ polish: true, perSlide: true, polishFollowUps: false }) }),
    { params: Promise.resolve({ subject, chapter, part: String(part) }) },
  );
  if (!res.ok) throw new Error(`render returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { slides: number; results: { fillPct: number }[]; polish?: string[] };
  return `${body.slides} page(s), fill ${body.results.map((r) => r.fillPct).join('/')}${body.polish?.length ? `; ${body.polish.join('; ')}` : ''}`;
}

/**
 * A later part's polish can shrink it enough to fit back into the part before: its pages return
 * there, the part is deleted and the earlier part is drawn again (no AI, just the render).
 */
async function reclaim(subject: string, chapter: string) {
  const { reclaimFollowUp } = await import('../lib/ai/spillover');
  const route = await import('../app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
  const notes: string[] = [];
  for (const p of [...(await listParts(subject, chapter))].reverse()) {
    const back = await reclaimFollowUp(subject, chapter, p);
    if (!back) continue;
    const res = await route.POST(
      new Request('http://build.local/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      { params: Promise.resolve({ subject, chapter, part: String(p) }) },
    );
    if (!res.ok) throw new Error(`render returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    notes.push(`reclaimed part ${back.part} into part ${p}`);
  }
  return notes.join('; ');
}

async function run() {
  const spec = JSON.parse(await fs.readFile(process.argv[2], 'utf8')) as Spec;
  const state = await loadState();
  for (const s of spec.filter((x) => !only || x.slug === only)) {
    if (!(await loadSubject(s.slug).catch(() => null))) await createSubject(s.slug, { name: s.name, emoji: s.emoji, description: s.description });
    for (const c of s.chapters) {
      const k = `${s.slug}/${c.slug}`;
      try {
        await stage(state, `${k}:create`, async () => { await createChapter(s.slug, c.slug, c.title, c.category); return ''; });
        await stage(state, `${k}:book`, async () => {
          const book = await bookFromTopic(s.slug, c.slug, c.topic);
          return `${book.chapters.length} chapters, ${book.chapters.reduce((n, x) => n + x.points.length, 0)} points`;
        });
        await stage(state, `${k}:plan`, async () => {
          const planned = await planPagesFromBook(s.slug, c.slug, 1);
          // Pages are fitted before anything renders: an over-long one would spill onto a stub page.
          const fit = await fitPlannedPages(s.slug, c.slug, 1);
          return `${planned.slides.length} page(s) planned, fitted ${fit.condensed}/${fit.condensed + fit.failed}`;
        });
        // A polish can spill into follow-up parts; re-list after each and polish those too.
        for (let i = 0; ; i++) {
          const parts = await listParts(s.slug, c.slug);
          if (i >= parts.length) break;
          await stage(state, `${k}/${parts[i]}:polish`, () => polish(s.slug, c.slug, parts[i]));
        }
        await stage(state, `${k}:reclaim`, () => reclaim(s.slug, c.slug));
        for (const p of skipReview ? [] : await listParts(s.slug, c.slug)) {
          await stage(state, `${k}/${p}:review`, async () => {
            const r = await reviewPart(s.slug, c.slug, p);
            const t: Record<string, number> = {};
            for (const f of r.findings) t[`${f.pass}/${f.severity}`] = (t[`${f.pass}/${f.severity}`] ?? 0) + 1;
            return `${r.findings.length} finding(s), passed=${r.passed} ${JSON.stringify(t)}`;
          });
        }
      } catch (err) {
        // One chapter failing must not sink the rest; its unfinished stages re-run next time.
        note(`${k} FAILED: ${String(err).slice(0, 300)}`);
      }
    }
  }
  note('all done');
}

// The knowledge graph's driver keeps sockets open, so a finished run must leave on purpose.
run().catch((err) => { note(`ABORTED: ${err}`); process.exitCode = 1; }).finally(async () => { await closeBrowser(); process.exit(); });
