import { promises as fs } from 'fs';
import type { AnimateRequest, JobState, VideoProvider } from '../videoProvider';

/**
 * The user's `webpage-mp4-plugin`, driven over its job API.
 *
 * It renders a phone browsing a page: flick scrolling with momentum, a finger,
 * reading pauses, a marker sweeping a named phrase, and a push-in so the text is
 * readable. For a researched reel that is not decoration — the page it visits is
 * the source that proves the line, and the phrase it sweeps is the pull quote
 * the critic kept. The citation stops being a chip in a review panel and becomes
 * the shot.
 *
 * One link per job rather than one job per reel: the studio's timeline does the
 * assembly, and a per-beat job can fail, be retried and be re-timed on its own.
 *
 * The plugin is not modified by any of this.
 */

export type WebpageOpts = {
  baseUrl?: string;
  /** Its own review pass inspects the render instead of trusting it. */
  review?: boolean;
  fetchImpl?: typeof fetch;
};

type Job = { id: string; status: string; error?: string; pages?: { slug?: string }[] };

export function createWebpageProvider(opts: WebpageOpts = {}): VideoProvider {
  const base = (opts.baseUrl ?? process.env.WEBPAGE_MP4_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
  const review = opts.review ?? true;
  const http = opts.fetchImpl ?? fetch;

  const job = async (id: string): Promise<Job> => {
    const r = await http(`${base}/v1/jobs/${id}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`webpage-mp4 job ${id} -> ${r.status}`);
    return (await r.json()) as Job;
  };

  return {
    name: 'webpage',

    async available() {
      try {
        const r = await http(`${base}/healthz`, { cache: 'no-store' });
        return r.ok;
      } catch {
        return false;
      }
    },

    async animate(req: AnimateRequest) {
      if (!req.url) throw new Error('a page visit needs a url — this beat has no citation to visit');

      const r = await http(`${base}/v1/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // The audio's duration is what sets this page's screen time, so the
          // page is up for exactly as long as its line is spoken. No dwell.
          links: [{ url: req.url, highlight: req.highlight || undefined, audio: req.audioPath }],
          review,
          label: req.brief.slice(0, 120),
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`webpage-mp4 submit -> ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
      const id = (body as Job).id;
      // A 2xx with no id used to become the string "undefined", and every poll
      // after it threw a 404 for a job that was never submitted.
      if (!id) throw new Error('webpage-mp4 accepted the job but returned no id');
      return { jobId: String(id) };
    },

    async jobState(jobId: string): Promise<JobState> {
      const j = await job(jobId);
      if (j.status === 'succeeded') return 'ready';
      if (j.status === 'failed' || j.status === 'canceled') return 'failed';
      return 'running';
    },

    async collect(jobId: string, dest: string) {
      const j = await job(jobId);
      // One link per job, so the reel it stitched is that single clip. Taking the
      // stitched file rather than the per-slug clip avoids depending on how the
      // plugin slugs a url.
      const r = await http(`${base}/v1/jobs/${jobId}/reel`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`webpage-mp4 result ${jobId} -> ${r.status} (job ${j.status})`);
      await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
    },
  };
}

/**
 * What the plugin's own review pass said about a finished job.
 *
 * Surfaced rather than swallowed: a clip that fails its own review should be
 * marked failed and retried, not shipped quietly into a reel.
 */
export async function reviewOf(
  jobId: string,
  opts: WebpageOpts = {}
): Promise<{ ok: boolean; notes: string } | null> {
  const base = (opts.baseUrl ?? process.env.WEBPAGE_MP4_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
  const http = opts.fetchImpl ?? fetch;
  try {
    const r = await http(`${base}/v1/jobs/${jobId}/review`, { cache: 'no-store' });
    if (!r.ok) return null;
    const body = (await r.json()) as { ok?: boolean; verdict?: string; notes?: unknown };
    return {
      ok: body.ok ?? body.verdict === 'pass',
      notes: typeof body.notes === 'string' ? body.notes : JSON.stringify(body).slice(0, 400),
    };
  } catch {
    return null;
  }
}
