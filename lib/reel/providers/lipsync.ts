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
 * `fast` is off. The four-step distill LoRA was on by default here on the belief that full
 * quality cost half an hour a beat — true of the model this was first written against, not
 * of Wan S2V, which is 18 seconds at four steps and 30 to 60 at ten. Measured side by side
 * on the same seed and audio, four steps printed garbled lettering across the presenter's
 * shirt and produced no gesture at all; ten steps did neither. A dozen renders is minutes
 * either way, so the draft setting is opt-in now.
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

/**
 * What the model must not draw.
 *
 * Wan renders letterforms unasked — a shot came back with garbled type across the
 * presenter's shirt, which is baked into the footage and survives every edit downstream.
 * The renderer's own default covers the usual artefacts in Chinese; sending our own
 * replaces it, so the parts worth keeping are carried here alongside the text clauses.
 */
const NO_TEXT_NEGATIVE =
  '字幕，文字，标志，水印，色调艳丽，过曝，静态，细节模糊不清，画面静止，' +
  'text, letters, words, lettering, captions, subtitles, watermark, logo, signage, ' +
  'garbled text, gibberish writing, printed words on clothing';

export function createLipsyncProvider(opts: LipsyncOpts = {}): VideoProvider {
  const base = (opts.baseUrl ?? process.env.LIPSYNC_URL ?? 'http://127.0.0.1:8300').replace(/\/$/, '');
  const http = opts.fetchImpl ?? fetch;
  const fast = opts.fast ?? false;

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
          params: {
            image_path: req.imagePath,
            audio_path: req.audioPath,
            prompt: req.brief,
            negative: NO_TEXT_NEGATIVE,
            preset: opts.preset ?? (req.ratio === '9:16' ? 'portrait' : 'square'),
            // Rendered at the reel's own rate: 16fps footage in a 30fps reel is duplicated
            // frames, which reads as judder however good the shot is.
            fps: req.fps,
            fast,
            ...(req.steps ? { steps: req.steps } : {}),
            ...(req.seed >= 0 ? { seed: req.seed % 2147483647 } : {}),
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
