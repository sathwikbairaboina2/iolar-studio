/**
 * Drives the whole handbook corpus to a current, passing review.
 *
 * Per chapter: repair coverage (it appends pages, so it must run before the flow settles
 * them). Per part: the polish render — which already densifies, rolls the densify back if
 * it lowered the worst fill, loops fixHeadings until no "(cont.)" title survives, and
 * re-renders — then the review.
 *
 * Every stage is recorded the moment it finishes, so a crash costs one stage. Re-running
 * resumes at the first stage that is not recorded.
 *
 *   npx tsx scripts/quality-campaign.mts [--subject <slug>] [--parts <n>] [--dry-run]
 */
import { listSubjects, listChapters, listParts } from '../lib/store';
import { repairCoverage } from '../lib/ai/repair';
import { reviewPart } from '../lib/verify/review';
import { loadState, isDone, markDone } from '../lib/verify/campaignState';

const args = process.argv.slice(2);
const only = args.includes('--subject') ? args[args.indexOf('--subject') + 1] : null;
const dryRun = args.includes('--dry-run');
/**
 * Stop after this many parts finish both stages in this run, so a batch can be inspected
 * before the next. A part whose stages were all recorded earlier does not count.
 */
const batch = args.includes('--parts') ? Number(args[args.indexOf('--parts') + 1]) : Infinity;
let finishedThisRun = 0;

/** Three parts in a row failing means the run is broken, not the content. */
const MAX_CONSECUTIVE_FAILURES = 3;
let consecutiveFailures = 0;

function note(msg: string) {
  console.log(`[campaign] ${msg}`);
}

/**
 * Calls the render route handler in-process. `polishFollowUps: false` because the route
 * chains follow-ups over `fetch`, which needs a live server — and this loop visits every
 * part anyway, including one a spill has just minted.
 */
async function polishPart(subject: string, chapter: string, part: number) {
  const route = await import('../app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
  const req = new Request('http://campaign.local/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ polish: true, polishFollowUps: false }),
  });
  const res = await route.POST(req, {
    params: Promise.resolve({ subject, chapter, part: String(part) }),
  });
  if (!res.ok) throw new Error(`render returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { slides: number; polish?: string[] };
}

async function run() {
  const state = await loadState();
  const subjects = (await listSubjects()).filter((s) => !only || s.slug === only);
  note(`${subjects.length} subject(s)${dryRun ? ' — DRY RUN, nothing will be written' : ''}`);

  for (const subject of subjects) {
    for (const chapter of await listChapters(subject.slug)) {
      const chKey = `${subject.slug}/${chapter.slug}`;

      if (!isDone(state, chKey, 'coverage')) {
        if (dryRun) note(`would repair coverage: ${chKey}`);
        else {
          try {
            const repair = await repairCoverage(subject.slug, chapter.slug);
            note(`coverage ${chKey}: ${repair ? `recovered ${repair.recovered.length}` : 'nothing missing'}`);
            await markDone(state, chKey, 'coverage');
          } catch (err) {
            note(`coverage ${chKey} FAILED: ${String(err).slice(0, 160)}`);
          }
        }
      }

      // Re-read parts after the repair: it can append to the last part, and a spill during
      // the polish below can mint a new one.
      for (const part of await listParts(subject.slug, chapter.slug)) {
        const key = `${chKey}/${part}`;
        for (const stage of ['polish', 'review'] as const) {
          if (isDone(state, key, stage)) continue;
          if (dryRun) { note(`would ${stage}: ${key}`); continue; }
          try {
            if (stage === 'polish') {
              const out = await polishPart(subject.slug, chapter.slug, part);
              note(`polish ${key}: ${out.slides} page(s)${out.polish?.length ? ` — ${out.polish.join('; ')}` : ''}`);
            } else {
              const review = await reviewPart(subject.slug, chapter.slug, part);
              note(`review ${key}: ${review.findings.length} finding(s), passed=${review.passed}`);
            }
            await markDone(state, key, stage);
            consecutiveFailures = 0;
            if (stage === 'review' && isDone(state, key, 'polish') && ++finishedThisRun >= batch) {
              note(`batch of ${batch} part(s) finished — stopping`);
              return;
            }
          } catch (err) {
            consecutiveFailures++;
            note(`${stage} ${key} FAILED (${consecutiveFailures}): ${String(err).slice(0, 160)}`);
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              throw new Error(`${MAX_CONSECUTIVE_FAILURES} stages failed in a row — stopping`);
            }
          }
        }
      }
    }
  }
  note('done');
}

run().catch((err) => { console.error(`[campaign] ABORTED: ${err}`); process.exit(1); });
