import { promises as fs } from 'fs';
import { ServiceDown, download, job, submit, templates, validate } from '@/lib/templates/service';
import { explainerMp4, explainerRendersDir, explainerTimelineFile } from '@/lib/paths';
import type { ExplainerDoc } from './schema';

/**
 * What the studio knows about rendering an explainer: nothing, except how to ask.
 *
 * The templates service on 26200 owns the contract, the validation and the pixels. The studio
 * fetches what it is allowed to author, sends a document, and waits. Every limit quoted in the
 * editor comes from here rather than being restated — a number restated in two places is a number
 * that will disagree with itself.
 */

export type ExplainerContract = {
  themes: string[];
  themeModes: Record<string, 'light' | 'dark'>;
  mutations: Record<string, { requires: string[]; sets?: string[]; fields?: string[] }>;
  states: string[];
  icons: string[];
  roles: string[];
  defaults: Record<string, number>;
  limits: Record<string, number>;
};

/** The contract, or null when the service is down — a dead service is not an error to the editor. */
export async function contract(): Promise<ExplainerContract | null> {
  try {
    const all = await templates();
    const found = all.find((t) => t.name === 'explainer') as unknown as ExplainerContract | undefined;
    return found ?? null;
  } catch (err) {
    if (err instanceof ServiceDown) return null;
    throw err;
  }
}

export type RenderResult = {
  ok: boolean;
  jobId: string | null;
  mp4: string | null;
  seconds: number | null;
  error: string | null;
};

const POLL_MS = 1200;
const GIVE_UP_MS = 15 * 60 * 1000;

/**
 * Submit, wait, keep the mp4 beside the document.
 *
 * Validation happens first and separately so a bad document is reported as a document problem
 * rather than as a failed render.
 */
export async function render(slug: string, doc: ExplainerDoc): Promise<RenderResult> {
  await validate(doc);

  const { id } = await submit(doc);
  const started = Date.now();
  for (;;) {
    const state = await job(id);
    if (state.state === 'done') break;
    if (state.state === 'failed') {
      return { ok: false, jobId: id, mp4: null, seconds: null, error: state.error ?? 'the render failed' };
    }
    if (Date.now() - started > GIVE_UP_MS) {
      return { ok: false, jobId: id, mp4: null, seconds: null, error: 'the render did not finish in fifteen minutes' };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  await fs.mkdir(explainerRendersDir(slug), { recursive: true });
  await download(id, explainerMp4(slug));

  const timeline = (await job(id)).timeline as { totalFrames?: number; fps?: number } | null;
  if (timeline) {
    await fs.writeFile(explainerTimelineFile(slug), JSON.stringify(timeline, null, 2), 'utf8');
  }
  const seconds =
    timeline?.totalFrames && timeline?.fps ? Math.round((timeline.totalFrames / timeline.fps) * 10) / 10 : null;

  return { ok: true, jobId: id, mp4: explainerMp4(slug), seconds, error: null };
}

export { ServiceDown };
export { ServiceRejected } from '@/lib/templates/service';
