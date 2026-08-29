import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { getSettings } from '../settings';
import { run } from '../reel/probe';
import { comfyUrl, getStats, uploadImage } from './client';

export type I2vOpts = {
  imagePath: string;
  brief: string;
  seconds: number;
  seed: number;
  ratio?: string;
  megapixels?: number;
  turbo?: boolean;
};

/** Slot addresses of the bundled MiniMax H3 image-to-video template. */
export const I2V_SLOTS = {
  image: '114.image',
  prompt: '105/104.prompt',
  seed: '105/15.noise_seed',
  seconds: '105/111.value',
  aspect: '115.aspect_ratio',
  megapixels: '115.megapixels',
  filenamePrefix: '92.filename_prefix',
  /**
   * The template's Lightning LoRA switch: on = the 8-step LoRA at 6 sampler steps,
   * off = the base model at 20.
   *
   * Fewer steps, but measured SLOWER here — 595s against 351s for the same 4-second
   * shot at the same size. The base weights are int8 and the LoRA is bf16, so enabling
   * it appears to pull the model off its quantised path and cost more than the steps
   * save. Left off by default; the slot stays exposed for a machine where that trade
   * comes out the other way.
   */
  turbo: '105/126.value',
} as const;

const ASPECTS: Record<string, string> = {
  '9:16': '9:16 (Portrait Widescreen)',
  '4:5': '3:4 (Portrait Standard)',
  '1:1': '1:1 (Square)',
};

export function templatePath() {
  return path.join(process.cwd(), 'lib', 'comfy', 'workflows', 'i2v.template.json');
}

export async function i2vAvailable(): Promise<boolean> {
  if (!(await getStats()).up) return false;
  try {
    await fs.access(templatePath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps a shot brief into a prompt MiniMax H3 will not try to type out.
 *
 * The model renders text: fed a bare direction like "slow, steady push in", it burns those
 * words into the frame as a caption, which then degrades into garbled letters over the clip.
 * The brief is stated as a scene, and on-screen text is ruled out explicitly.
 */
export function scenePrompt(brief: string): string {
  const scene = brief.trim().replace(/\s+/g, ' ');
  return [
    `Live footage of: ${scene}.`,
    'Camera moves slowly and steadily. The existing content stays sharp, legible and unchanged.',
    'Do not add or alter any text. No captions, no subtitles, no titles, no watermarks, no logos.',
    'No cuts, no transitions, no people entering the frame.',
  ].join(' ');
}

export function slotOverrides(o: {
  imageName: string;
  brief: string;
  seconds: number;
  seed: number;
  ratio: string;
  megapixels: number;
  prefix: string;
  turbo: boolean;
}): string[] {
  return [
    `${I2V_SLOTS.image}=${JSON.stringify(o.imageName)}`,
    `${I2V_SLOTS.prompt}=${JSON.stringify(scenePrompt(o.brief))}`,
    `${I2V_SLOTS.seed}=${o.seed}`,
    `${I2V_SLOTS.seconds}=${o.seconds}`,
    `${I2V_SLOTS.aspect}=${JSON.stringify(ASPECTS[o.ratio] ?? ASPECTS['9:16'])}`,
    `${I2V_SLOTS.megapixels}=${o.megapixels}`,
    `${I2V_SLOTS.filenamePrefix}=${JSON.stringify(o.prefix)}`,
    `${I2V_SLOTS.turbo}=${o.turbo}`,
  ];
}

/**
 * Writes a parameterised copy of the template.
 *
 * comfy-cli owns slot addressing (the template uses subgraphs, where a slot is
 * `instance/node.field`), so the edit goes through `comfy workflow set-slot`
 * rather than hand-patching widget arrays.
 */
export async function writeParameterisedWorkflow(o: I2vOpts & { prefix: string }): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'iolar-i2v-'));
  const dest = path.join(dir, 'workflow.json');
  await fs.copyFile(templatePath(), dest);
  const overrides = slotOverrides({
    imageName: path.basename(o.imagePath),
    brief: o.brief,
    seconds: o.seconds,
    seed: o.seed,
    ratio: o.ratio ?? '9:16',
    megapixels: o.megapixels ?? 0.9,
    prefix: o.prefix,
    turbo: o.turbo ?? getSettings().i2vTurbo,
  });
  const { code, stderr } = await run('comfy', ['workflow', 'set-slot', dest, ...overrides], {
    timeoutMs: 120_000,
  });
  if (code !== 0) throw new Error(`comfy workflow set-slot failed: ${stderr.slice(0, 300)}`);
  return dest;
}

export function parsePromptId(ndjson: string): string {
  for (const line of ndjson.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const evt = JSON.parse(line);
      const id = evt.prompt_id ?? evt.data?.prompt_id ?? evt.result?.prompt_id;
      if (id) return String(id);
    } catch {
      // Not an event line; keep scanning.
    }
  }
  throw new Error(`comfy run reported no prompt id: ${ndjson.slice(0, 200)}`);
}

/** Uploads the still, submits the workflow, and returns without waiting. */
export async function animateImage(o: I2vOpts): Promise<{ promptId: string; workflow: string }> {
  const name = `reel-${Date.now()}-${path.basename(o.imagePath)}`;
  await uploadImage(o.imagePath, name);
  const workflow = await writeParameterisedWorkflow({ ...o, imagePath: name, prefix: `video/reel-${o.seed}` });
  const url = new URL(comfyUrl());
  const { code, stdout, stderr } = await run(
    'comfy',
    [
      'run',
      '--workflow', workflow,
      '--json',
      '--no-notify',
      '--host', url.hostname,
      '--port', url.port || '8188',
    ],
    { timeoutMs: 300_000 }
  );
  if (code !== 0) throw new Error(`comfy run failed: ${(stderr || stdout).slice(0, 300)}`);
  return { promptId: parsePromptId(stdout), workflow };
}

type OutputRef = { filename: string; subfolder: string; type: string };

export function pickVideoOutput(entry: unknown): OutputRef | null {
  const outputs = (entry as { outputs?: Record<string, Record<string, OutputRef[]>> })?.outputs ?? {};
  const files: OutputRef[] = [];
  for (const node of Object.values(outputs)) {
    for (const key of ['videos', 'gifs', 'images']) for (const f of node[key] ?? []) files.push(f);
  }
  return files.find((f) => /\.(mp4|webm|mkv)$/i.test(f.filename)) ?? files[0] ?? null;
}

/** ComfyUI keeps finished outputs in /history; pull the clip out and save it. */
export async function collectVideo(promptId: string, dest: string): Promise<{ path: string }> {
  const r = await fetch(`${comfyUrl()}/history/${promptId}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`comfy history -> ${r.status}`);
  const entry = (await r.json())[promptId];
  if (!entry) throw new Error('comfy job not in history yet');
  if (entry.status?.status_str === 'error') {
    throw new Error(`comfy job failed: ${JSON.stringify(entry.status?.messages ?? []).slice(0, 300)}`);
  }
  const vid = pickVideoOutput(entry);
  if (!vid) throw new Error('comfy job produced no video output');
  const q = new URLSearchParams({ filename: vid.filename, subfolder: vid.subfolder, type: vid.type });
  const dl = await fetch(`${comfyUrl()}/view?${q}`);
  if (!dl.ok) throw new Error(`comfy view -> ${dl.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await dl.arrayBuffer()));
  return { path: dest };
}

/** Best-effort status for the shot queue: queued -> running -> ready/failed. */
export async function jobState(promptId: string): Promise<'queued' | 'running' | 'ready' | 'failed'> {
  try {
    const hist = await fetch(`${comfyUrl()}/history/${promptId}`, { cache: 'no-store' });
    if (hist.ok) {
      const entry = (await hist.json())[promptId];
      if (entry) {
        if (entry.status?.status_str === 'error') return 'failed';
        if (pickVideoOutput(entry)) return 'ready';
      }
    }
    const queue = await fetch(`${comfyUrl()}/queue`, { cache: 'no-store' });
    if (queue.ok) {
      const q = await queue.json();
      const running = (q.queue_running ?? []).some((row: unknown[]) => row[1] === promptId);
      if (running) return 'running';
    }
  } catch {
    // Comfy down: leave the job where it is rather than declaring it failed.
  }
  return 'queued';
}
