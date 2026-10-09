import { promises as fs } from 'fs';
import path from 'path';
import { subjectDir } from '@/lib/paths';
import { loadChapterMeta, loadSubject } from '@/lib/store';
import { loadBook } from '@/lib/ai/book';
import { editionHash, inputsHash, loadEdition } from '@/lib/digital/edition';
import { generateEdition, regenerateWithNotes } from '@/lib/digital/generate';
import { reviewAndFix } from '@/lib/digital/fix';
import { currentReview } from '@/lib/digital/review';
import type { Finding } from '@/lib/verify/gates';
import { exportSubject } from './export';
import { proposeOrder, type OrderInput } from './order';
import { updateState, type ChapterState, type PublishState } from './state';

export type JobStep = { chapter: string; pass: string; state: 'queued' | 'running' | 'done' | 'skipped' };
export type PublishJob = {
  subject: string;
  live: boolean;
  startedAt: string;
  finishedAt?: string;
  stage: 'reviews' | 'order' | 'export' | 'done';
  steps: JobStep[];
  message?: string;
};

/** The steps shown for each chapter, in order. */
export const CHAPTER_STEPS = ['generate', 'rules', 'facts', 'pedagogy', 'readability', 'fix'] as const;

const UNAVAILABLE = 'Claude is not available; reviews could not run';
/** A job file left "live" by a crashed server stops blocking new runs after this long. */
const STALE_MS = 3 * 60 * 60 * 1000;
/** The AI may approve an order on its own only at or above this confidence. */
const AUTO_ORDER_CONFIDENCE = 0.75;

const running = new Set<string>();

function jobFile(subject: string) {
  return path.join(subjectDir(subject), 'publish-job.json');
}

export async function readJob(subject: string): Promise<PublishJob | null> {
  try {
    return JSON.parse(await fs.readFile(jobFile(subject), 'utf8')) as PublishJob;
  } catch {
    return null;
  }
}

async function writeJob(job: PublishJob) {
  const file = jobFile(job.subject);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(job, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

const isUnavailable = (err: unknown) => (err as { name?: string } | null)?.name === 'ClaudeUnavailableError';
const hasUnavailable = (findings: Finding[]) => findings.some((f) => f.rule.endsWith('.unavailable'));

/** Starts a review-and-publish run in the background; throws 'busy' while one is live for the subject. */
export async function startPublish(subject: string, chapters: string[], opts: { notes?: Record<string, string> } = {}): Promise<PublishJob> {
  const existing = await readJob(subject);
  const liveFile = !!existing?.live && Date.now() - Date.parse(existing.startedAt) < STALE_MS;
  if (running.has(subject) || liveFile) throw new Error('busy');
  running.add(subject);
  try {
    await updateState(subject, (s) => {
      for (const c of chapters) s.chapters[c] = { ...s.chapters[c], selected: true };
    });
    const steps: JobStep[] = [
      ...chapters.flatMap((chapter): JobStep[] => CHAPTER_STEPS.map((pass) => ({ chapter, pass, state: 'queued' as const }))),
      { chapter: '', pass: 'order', state: 'queued' },
      { chapter: '', pass: 'export', state: 'queued' },
    ];
    const job: PublishJob = { subject, live: true, startedAt: new Date().toISOString(), stage: 'reviews', steps };
    await writeJob(job);
    void run(job, chapters, opts.notes ?? {})
      .catch(async (err) => {
        job.message = `The run stopped: ${err instanceof Error ? err.message : String(err)}`;
      })
      .finally(async () => {
        job.live = false;
        job.stage = 'done';
        job.finishedAt = new Date().toISOString();
        await writeJob(job).catch(() => {});
        running.delete(subject);
      });
    return job;
  } catch (err) {
    running.delete(subject);
    throw err;
  }
}

async function run(job: PublishJob, chapters: string[], notes: Record<string, string>) {
  const { subject } = job;
  // Marks may be fired from callbacks that do not wait, so the writes go one at a time, in the order they were asked.
  let chain: Promise<unknown> = Promise.resolve();
  const mark = (chapter: string, pass: string, state: JobStep['state']) => {
    const step = job.steps.find((s) => s.chapter === chapter && s.pass === pass);
    if (step) step.state = state;
    const next = chain.then(() => writeJob(job));
    chain = next.catch(() => {});
    return next;
  };
  const setMessage = (m: string) => { job.message = job.message ?? m; };

  for (const chapter of chapters) await reviewChapter(subject, chapter, mark, setMessage, notes[chapter]);

  job.stage = 'order';
  await mark('', 'order', 'running');
  try {
    await settleOrder(subject);
  } catch (err) {
    setMessage(`The order pass failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  await mark('', 'order', 'done');

  job.stage = 'export';
  await mark('', 'export', 'running');
  try {
    await exportSubject(subject);
  } catch (err) {
    setMessage(`The export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  await mark('', 'export', 'done');
}

async function reviewChapter(
  subject: string,
  chapter: string,
  mark: (chapter: string, pass: string, state: JobStep['state']) => Promise<void>,
  setMessage: (m: string) => void,
  notes?: string,
) {
  const markAll = async (passes: readonly string[], state: JobStep['state']) => { for (const p of passes) await mark(chapter, p, state); };
  const hash = await inputsHash(subject, chapter).catch(() => null);
  const state = await updateState(subject, (s) => s.chapters[chapter]);
  let edition = await loadEdition(subject, chapter);
  const editionIsCurrent = !!hash && !!edition && edition.inputsHash === hash;
  // Notes from a person always write the edition again.
  const reusable = !notes && editionIsCurrent && state?.hash === hash && !!state.verdict && state.editionHash === editionHash(edition!) && !hasUnavailable(state.findings ?? []);
  if (reusable) {
    await markAll(CHAPTER_STEPS, 'skipped');
    await updateState(subject, (s) => autoApprove(s, chapter));
    return;
  }

  let findings: Finding[] = [];
  let verdict: ChapterState['verdict'] = 'unsure';
  let reviewedEdition: string | undefined;
  try {
    if (editionIsCurrent && !notes) {
      await mark(chapter, 'generate', 'skipped');
    } else {
      // A failure here leaves any older edition untouched on disk, but it no longer matches the inputs, so it cannot go live.
      await mark(chapter, 'generate', 'running');
      edition = notes ? await regenerateWithNotes(subject, chapter, notes) : await generateEdition(subject, chapter);
      await mark(chapter, 'generate', 'done');
    }

    const saved = await currentReview(subject, chapter);
    let review = saved && !hasUnavailable(saved.findings) ? saved : null;
    if (review) {
      await markAll(CHAPTER_STEPS.slice(1), 'skipped');
    } else {
      let fixing = false;
      const AI = ['facts', 'pedagogy', 'readability'];
      review = await reviewAndFix(subject, chapter, {
        onStep: (step) => {
          if (step.startsWith('fix:') && !fixing) { fixing = true; mark(chapter, 'fix', 'running').catch(() => {}); }
        },
        onReviewStep: (step) => {
          if (step === 'rules') markAll(['rules'], 'running').catch(() => {});
          else if (step === 'ai') markAll(['rules'], 'done').then(() => markAll(AI, 'running')).catch(() => {});
          else if (step === 'done') markAll(AI, 'done').catch(() => {});
        },
      });
      await markAll(['rules', ...AI], 'done');
      await mark(chapter, 'fix', fixing ? 'done' : 'skipped');
    }
    findings = review.findings;
    verdict = review.verdict;
    reviewedEdition = review.editionHash;
    if (hasUnavailable(findings)) setMessage(UNAVAILABLE);
  } catch (err) {
    // A pass that could not run leaves the chapter for a person; it is neither failed nor live.
    setMessage(isUnavailable(err) ? UNAVAILABLE : `The edition could not be written or reviewed: ${err instanceof Error ? err.message : String(err)}`);
    findings = [{
      pass: 'publish', rule: 'publish.unavailable', severity: 'minor', page: 0,
      summary: isUnavailable(err) ? 'Claude was not available, so the chapter could not be reviewed.' : 'The edition could not be written or reviewed, so the chapter could not be published.',
      evidence: String(err).slice(0, 200), fix: 'Run the review again.',
    }];
    verdict = 'unsure';
    reviewedEdition = undefined;
    await markAll(CHAPTER_STEPS, 'done');
  }

  await updateState(subject, (s) => {
    // New content starts a new decision: earlier approvals and rejections belonged to the old text.
    s.chapters[chapter] = {
      selected: s.chapters[chapter]?.selected ?? true,
      hash: hash ?? undefined,
      editionHash: reviewedEdition,
      verdict,
      findings,
      reviewedAt: new Date().toISOString(),
    };
    autoApprove(s, chapter);
  });
}

/** The AI clears a passing chapter on its own unless this subject always asks. */
function autoApprove(s: PublishState, chapter: string) {
  const c = s.chapters[chapter];
  if (c && c.verdict === 'pass' && !c.approvedBy && !c.rejected && !s.alwaysAsk) {
    c.approvedBy = 'ai';
    c.approvedAt = new Date().toISOString();
  }
}

/** Proposes the order again only when the set of chapters or their content changed. */
async function settleOrder(subject: string) {
  const snapshot = await updateState(subject, (s) => s);
  const candidates = Object.entries(snapshot.chapters)
    .filter(([, c]) => c.selected && !c.rejected && c.verdict !== 'fail' && c.hash)
    .map(([slug, c]) => ({ slug, hash: c.hash! }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const basis = candidates.map((c) => `${c.slug}:${c.hash}`).join('|');

  if (!candidates.length) {
    await updateState(subject, (s) => { delete s.order; });
    return;
  }

  let proposal: Awaited<ReturnType<typeof proposeOrder>> | null = null;
  if (snapshot.order?.basis !== basis) {
    const meta = await loadSubject(subject);
    const inputs: OrderInput[] = [];
    for (const [i, c] of candidates.entries()) {
      const info = await loadChapterMeta(subject, c.slug);
      const book = await loadBook(subject, c.slug);
      inputs.push({ slug: c.slug, title: info.title, summary: book?.summary ?? '', outline: (book?.chapters ?? []).map((b) => b.title), studioOrder: info.order ?? i });
    }
    inputs.sort((a, b) => a.studioOrder - b.studioOrder);
    proposal = await proposeOrder(meta.name, inputs);
  }

  await updateState(subject, (s) => {
    if (proposal) s.order = { ...proposal, basis };
    const order = s.order;
    if (!order || order.approvedBy === 'human') return;
    const anyUnsure = Object.values(s.chapters).some((c) => c.selected && !c.rejected && c.verdict === 'unsure' && c.approvedBy !== 'human');
    if (order.confidence >= AUTO_ORDER_CONFIDENCE && !anyUnsure && !s.alwaysAsk) order.approvedBy = 'ai';
    else delete order.approvedBy;
  });
}
