import { promises as fs } from 'fs';
import type { AnimateRequest, JobState, VideoProvider } from '../videoProvider';

/**
 * The user's lipsync desk closeup, driven over its job API.
 *
 * Wan 2.2 S2V through ComfyUI's native audio-to-video nodes: one reference image
 * plus this beat's audio become a closeup of a person speaking it, with matched
 * lips and idle motion. It is what a talking-head beat is for.
 *
 * The API takes filesystem paths rather than uploads, which suits us — the beat
 * audio was cut on this machine and the presenter image lives in settings.
 *
 * `fast` is on by default: the distill LoRA is four steps instead of ten, and a
 * reel is a dozen renders, so the difference between five minutes and half an
 * hour per beat decides whether this is usable at all.
 *
 * The plugin is not modified by any of this.
 */

export type LipsyncOpts = {
  baseUrl?: string;
  fast?: boolean;
  preset?: 'square' | 'portrait' | 'landscape';
  fetchImpl?: typeof fetch;
};

type Job = { id: string; status: string; error?: string | null };

export function createLipsyncProvider(opts: LipsyncOpts = {}): VideoProvider {
  const base = (opts.baseUrl ?? process.env.LIPSYNC_URL ?? 'http://127.0.0.1:8300').replace(/\/$/, '');
  const http = opts.fetchImpl ?? fetch;
  const fast = opts.fast ?? true;

  return {
    name: 'lipsync',

    async available() {
      try {
        const r = await http(`${base}/healthz`, { cache: 'no-store' });
        if (!r.ok) return false;
        const body = (await r.json()) as { ok?: boolean; checks?: Record<string, { ok?: boolean }> };
        // Its health check covers the things that actually stop a render: the
        // queue, the worker, ComfyUI itself and whether the models are present.
        return Boolean(body.ok);
      } catch {
        return false;
      }
    },

    async animate(req: AnimateRequest) {
      if (!req.imagePath) {
        throw new Error('a talking-head shot needs a presenter image — set one in settings');
      }

      const r = await http(`${base}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'lipsync',
          params: {
            image_path: req.imagePath,
            audio_path: req.audioPath,
            prompt: req.brief,
            preset: opts.preset ?? (req.ratio === '9:16' ? 'portrait' : 'square'),
            fast,
            ...(req.seed >= 0 ? { seed: req.seed % 2147483647 } : {}),
          },
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`lipsync submit -> ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
      return { jobId: String((body as Job).id) };
    },

    async jobState(jobId: string): Promise<JobState> {
      const r = await http(`${base}/jobs/${jobId}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`lipsync job ${jobId} -> ${r.status}`);
      const j = (await r.json()) as Job;
      if (j.status === 'succeeded') return 'ready';
      if (j.status === 'failed' || j.status === 'cancelled') return 'failed';
      return 'running';
    },

    async collect(jobId: string, dest: string) {
      const r = await http(`${base}/jobs/${jobId}/result`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`lipsync result ${jobId} -> ${r.status}`);
      await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
    },
  };
}

/** Queue depth, so a board can say how long a waiting job has to wait. */
export async function queueDepth(opts: LipsyncOpts = {}): Promise<{ running: number; queued: number } | null> {
  const base = (opts.baseUrl ?? process.env.LIPSYNC_URL ?? 'http://127.0.0.1:8300').replace(/\/$/, '');
  const http = opts.fetchImpl ?? fetch;
  try {
    const r = await http(`${base}/queue`, { cache: 'no-store' });
    if (!r.ok) return null;
    const body = (await r.json()) as { running?: unknown; pending?: unknown[] };
    return { running: body.running ? 1 : 0, queued: Array.isArray(body.pending) ? body.pending.length : 0 };
  } catch {
    return null;
  }
}
