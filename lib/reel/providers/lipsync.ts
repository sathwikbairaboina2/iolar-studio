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
 * The studio sends the image, the audio and the shape it needs back. Steps, frame rate,
 * sampler, negative prompt and frame size all belong to the plugin, which documents its own
 * measurements for them. Sending a per-shot written brief as the prompt was measurably
 * worse than sending none: on the same seed and audio, the prompted take re-interpreted the
 * composition every chunk and drifted, where the unprompted one held the photo's framing.
 *
 * The plugin is not modified by any of this.
 */

export type LipsyncOpts = {
  baseUrl?: string;
  preset?: 'square' | 'portrait' | 'landscape';
  fetchImpl?: typeof fetch;
};

type Job = { id: string; status: string; error?: string | null };

export function createLipsyncProvider(opts: LipsyncOpts = {}): VideoProvider {
  const base = (opts.baseUrl ?? process.env.LIPSYNC_URL ?? 'http://127.0.0.1:8300').replace(/\/$/, '');
  const http = opts.fetchImpl ?? fetch;

  return {
    name: 'lipsync',

    async available() {
      try {
        // Answering at all is the bar. Its health check also reports on ComfyUI,
        // and ComfyUI reports unhealthy while it is busy rendering — so gating on
        // the sub-checks marked five beats "no provider wired" purely because the
        // first one was still going. A queue exists for exactly this.
        const r = await http(`${base}/healthz`, { cache: 'no-store' });
        return r.ok;
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
          // Only what the renderer needs to make this shot. Everything else — steps, frame
          // rate, negative prompt, frame size — is the plugin's own business, and the
          // studio sending its opinion about them is how a written brief ended up fighting
          // the reference photo and drifting the framing every chunk.
          params: {
            image_path: req.imagePath,
            audio_path: req.audioPath,
            preset: opts.preset ?? (req.ratio === '9:16' ? 'portrait' : 'square'),
          },
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`lipsync submit -> ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
      const id = (body as Job).id;
      if (!id) throw new Error('lipsync accepted the job but returned no id');
      return { jobId: String(id) };
    },

    async jobState(jobId: string): Promise<JobState> {
      const r = await http(`${base}/jobs/${jobId}`, { cache: 'no-store' });
      if (r.status === 404) return 'gone';
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
