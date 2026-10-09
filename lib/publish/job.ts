import { promises as fs } from 'fs';
import path from 'path';
import { subjectDir } from '@/lib/paths';
import { listParts, loadChapterMeta, loadSubject } from '@/lib/store';
import { loadBook } from '@/lib/ai/book';
import { reviewIsCurrent, reviewPart } from '@/lib/verify/review';
import type { Finding } from '@/lib/verify/gates';
import { digitalReview } from './digital';
import { exportSubject } from './export';
import { chapterHash } from './hash';
import { proposeOrder, type OrderInput } from './order';
import { updateState, type ChapterState, type PublishState } from './state';
import { chapterVerdict, partReviewsFor } from './verdict';

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
export async function startPublish(subject: string, chapters: string[]): Promise<PublishJob> {
  const existing = await readJob(subject);
  const liveFile = !!existing?.live && Date.now() - Date.parse(existing.startedAt) < STALE_MS;
  if (running.has(subject) || liveFile) throw new Error('busy');
  running.add(subject);
  try {
    await updateState(subject, (s) => {
      for (const c of chapters) s.chapters[c] = { ...s.chapters[c], selected: true };
    });
    const steps: JobStep[] = [
      ...chapters.flatMap((chapter): JobStep[] => [{ chapter, pass: 'reviews', state: 'queued' }, { chapter, pass: 'digital', state: 'queued' }]),
      { chapter: '', pass: 'order', state: 'queued' },
      { chapter: '', pass: 'export', state: 'queued' },
    ];
    const job: PublishJob = { subject, live: true, startedAt: new Date().toISOString(), stage: 'reviews', steps };
    await writeJob(job);
    void run(job, chapters)
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

async function run(job: PublishJob, chapters: string[]) {
  const { subject } = job;
  const mark = async (chapter: string, pass: string, state: JobStep['state']) => {
    const step = job.steps.find((s) => s.chapter === chapter && s.pass === pass);
    if (step) step.state = state;
    await writeJob(job);
  };
  const setMessage = (m: string) => { job.message = job.message ?? m; };

  for (const chapter of chapters) await reviewChapter(subject, chapter, mark, setMessage);

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
) {
  const hash = await chapterHash(subject, chapter).catch(() => null);
  const state = await updateState(subject, (s) => s.chapters[chapter]);
  const reusable = !!hash && state?.hash === hash && !!state.verdict && !hasUnavailable(state.findings ?? []);
  if (reusable) {
    await mark(chapter, 'reviews', 'skipped');
    await mark(chapter, 'digital', 'skipped');
    await updateState(subject, (s) => autoApprove(s, chapter));
    return;
  }

  let findings: Finding[] = [];
  let verdict: ChapterState['verdict'] = 'unsure';
  try {
    await mark(chapter, 'reviews', 'running');
    for (const n of await listParts(subject, chapter)) {
      if (!(await reviewIsCurrent(subject, chapter, n))) await reviewPart(subject, chapter, n);
    }
    await mark(chapter, 'reviews', 'done');
    await mark(chapter, 'digital', 'running');
    const parts = await partReviewsFor(subject, chapter);
    const digital = await digitalReview(subject, chapter);
    await mark(chapter, 'digital', 'done');
    findings = [...parts.findings.flat(), ...digital];
    verdict = chapterVerdict(parts.findings, digital);
    if (hasUnavailable(findings)) setMessage(UNAVAILABLE);
  } catch (err) {
    // A pass that could not run leaves the chapter for a person; it is neither failed nor live.
    setMessage(isUnavailable(err) ? UNAVAILABLE : `A review pass failed: ${err instanceof Error ? err.message : String(err)}`);
    findings = [{
      pass: 'publish', rule: 'publish.unavailable', severity: 'minor', page: 0,
      summary: isUnavailable(err) ? 'Claude was not available, so the chapter could not be reviewed.' : 'A review pass failed, so the chapter could not be reviewed.',
      evidence: String(err).slice(0, 120), fix: 'Run the review again.',
    }];
    verdict = 'unsure';
    await mark(chapter, 'reviews', 'done');
    await mark(chapter, 'digital', 'done');
  }

  await updateState(subject, (s) => {
    // New content starts a new decision: earlier approvals and rejections belonged to the old text.
    s.chapters[chapter] = {
      selected: s.chapters[chapter]?.selected ?? true,
      hash: hash ?? undefined,
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
