import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import {
  explainerRenderMp4, explainerRenderPoster, explainerRenderTimeline, explainerRendersDir,
  explainerRendersIndex, isSlug,
} from '@/lib/paths';
import { cancel as cancelJob, download, job, submit, validate, type ServiceOpts } from '@/lib/templates/service';
import * as poster from './poster';
import type { ExplainerDoc } from './schema';

/**
 * A render is a job, and the jobs are kept.
 *
 * The studio submits and walks away; every later answer comes from asking the service about the
 * records that are not finished yet. The job id names the mp4 beside the record, so a record and
 * its file cannot come apart the way one fixed `reel.mp4` and an id held elsewhere can.
 */

export type RenderState = 'queued' | 'preparing' | 'rendering' | 'done' | 'failed';

export type RenderRecord = {
  id: string;
  submittedAt: string;
  finishedAt: string | null;
  state: RenderState;
  /** 0..1 from the service while the job runs; null once it is not running. */
  progress: number | null;
  error: string | null;
  seconds: number | null;
  frames: number | null;
  /** The document this was rendered from, so a later edit shows the render as out of date. */
  docHash: string;
  title: string;
  theme: string;
};

export type RenderLog = {
  renders: RenderRecord[];
  live: boolean;
  /** The hash of the document as it stands now. A record that does not match it is stale. */
  currentHash: string;
};

/** Twenty is about a day of iterating on one explainer, and about 40 MB of mp4 at that. */
export const KEEP = 20;

const LIVE: ReadonlySet<string> = new Set(['queued', 'preparing', 'rendering']);
const isLive = (r: RenderRecord) => LIVE.has(r.state);

/**
 * The store writes documents through a schema parse, so key order is stable and so is this.
 * A hash that changed for the same document would report every render as stale.
 */
export function hashDoc(doc: ExplainerDoc): string {
  return createHash('sha1').update(JSON.stringify(doc)).digest('hex').slice(0, 12);
}

type Stored = { version: 1; renders: RenderRecord[] };

async function readFile(slug: string): Promise<RenderRecord[]> {
  try {
    const raw = await fs.readFile(explainerRendersIndex(slug), 'utf8');
    const parsed = JSON.parse(raw) as Stored;
    return Array.isArray(parsed.renders) ? parsed.renders : [];
  } catch {
    return [];
  }
}

async function writeFile(slug: string, renders: RenderRecord[]): Promise<RenderRecord[]> {
  const kept = renders.slice(0, KEEP);
  await fs.mkdir(explainerRendersDir(slug), { recursive: true });
  const stored: Stored = { version: 1, renders: kept };
  await fs.writeFile(explainerRendersIndex(slug), JSON.stringify(stored, null, 2), 'utf8');

  // What fell off the end takes its files with it, or the folder grows without bound while the
  // list claims otherwise.
  for (const gone of renders.slice(KEEP)) {
    await fs.rm(explainerRenderMp4(slug, gone.id), { force: true });
    await fs.rm(explainerRenderTimeline(slug, gone.id), { force: true });
    await fs.rm(explainerRenderPoster(slug, gone.id), { force: true });
  }
  return kept;
}

export async function read(slug: string, doc?: ExplainerDoc | null): Promise<RenderLog> {
  const renders = isSlug(slug) ? await readFile(slug) : [];
  return { renders, live: renders.some(isLive), currentHash: doc ? hashDoc(doc) : '' };
}

/**
 * Validate, submit, remember.
 *
 * Validation first and separately: a document the service will not take is a document problem,
 * and it should never become a failed job in this list.
 */
export async function start(slug: string, doc: ExplainerDoc, opts: ServiceOpts = {}): Promise<RenderRecord> {
  if (!isSlug(slug)) throw new Error(`bad slug "${slug}"`);
  await validate(doc, opts);
  const { id } = await submit(doc, opts);

  const record: RenderRecord = {
    id,
    submittedAt: new Date().toISOString(),
    finishedAt: null,
    state: 'queued',
    progress: 0,
    error: null,
    seconds: null,
    frames: null,
    docHash: hashDoc(doc),
    title: doc.scene.title,
    theme: doc.theme,
  };
  await writeFile(slug, [record, ...(await readFile(slug))]);
  return record;
}

type Timeline = { totalFrames?: number; fps?: number } | null;

/**
 * Ask the service about everything still running, and write down what it says.
 *
 * Nothing running means nothing asked: a hook polling this route every second must not turn into
 * a request per second against the service for a job that finished yesterday.
 */
export async function poll(slug: string, opts: ServiceOpts = {}): Promise<RenderLog> {
  const renders = await readFile(slug);
  const running = renders.filter(isLive);
  if (running.length === 0) return { renders, live: false, currentHash: '' };

  const next = [...renders];
  for (const record of running) {
    const remote = await job(record.id, opts);
    const at = next.findIndex((r) => r.id === record.id);

    if (remote.state === 'done') {
      // The file comes home first. A record that says done before its mp4 exists is a record the
      // player will 404 on.
      await download(record.id, explainerRenderMp4(slug, record.id), opts);
      // The still the shelf shows, taken now because this is the one moment we know the mp4 is
      // whole and nobody is waiting on it. It answers null rather than throwing when it cannot.
      await poster.write(slug, record.id);
      const timeline = remote.timeline as Timeline;
      if (timeline) {
        await fs.writeFile(explainerRenderTimeline(slug, record.id), JSON.stringify(timeline, null, 2), 'utf8');
      }
      const frames = timeline?.totalFrames ?? null;
      const fps = timeline?.fps ?? null;
      next[at] = {
        ...next[at],
        state: 'done',
        progress: null,
        error: null,
        finishedAt: new Date().toISOString(),
        frames,
        seconds: frames && fps ? Math.round((frames / fps) * 10) / 10 : null,
      };
      continue;
    }

    if (remote.state === 'failed') {
      next[at] = {
        ...next[at],
        state: 'failed',
        progress: null,
        error: remote.error ?? 'the render failed',
        finishedAt: new Date().toISOString(),
      };
      continue;
    }

    next[at] = { ...next[at], state: remote.state as RenderState, progress: remote.progress };
  }

  const kept = await writeFile(slug, next);
  return { renders: kept, live: kept.some(isLive), currentHash: '' };
}

/**
 * Stop a render that is still running.
 *
 * The service drops the job, so nothing will ever answer for it again; the record is written as
 * failed with the reason, which is what "stopped" looks like to everything that reads this list.
 */
export async function cancel(slug: string, id: string, opts: ServiceOpts = {}): Promise<RenderLog> {
  const renders = await readFile(slug);
  const at = renders.findIndex((r) => r.id === id);
  if (at === -1 || !isLive(renders[at])) return read(slug);

  await cancelJob(id, opts);
  renders[at] = {
    ...renders[at], state: 'failed', progress: null, error: 'stopped here',
    finishedAt: new Date().toISOString(),
  };
  const kept = await writeFile(slug, renders);
  return { renders: kept, live: kept.some(isLive), currentHash: '' };
}

/** The newest render there is an mp4 for. A failure after it does not hide it. */
export async function latestDone(slug: string): Promise<RenderRecord | null> {
  const renders = await readFile(slug);
  return renders.find((r) => r.state === 'done') ?? null;
}
