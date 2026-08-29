import { promises as fs } from 'fs';
import path from 'path';
import { getSettings } from '../settings';

export function comfyUrl() {
  return getSettings().comfyUrl;
}

async function comfyFetch(p: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(`${comfyUrl()}${p}`, { cache: 'no-store', ...init });
  if (!r.ok) throw new Error(`comfy ${p} -> ${r.status}`);
  return r;
}

export async function getStats(): Promise<{ up: boolean; gpu?: string; vramFreeGb?: number; vramTotalGb?: number }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const r = await comfyFetch('/system_stats', { signal: ctrl.signal });
    clearTimeout(timer);
    const stats = await r.json();
    const dev = stats.devices?.[0];
    return {
      up: true,
      gpu: dev?.name ?? 'GPU',
      vramFreeGb: dev ? +(dev.vram_free / 1e9).toFixed(1) : undefined,
      vramTotalGb: dev ? +(dev.vram_total / 1e9).toFixed(1) : undefined,
    };
  } catch {
    return { up: false };
  }
}

export async function queuePrompt(workflow: object): Promise<{ prompt_id: string }> {
  const r = await comfyFetch('/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  return r.json();
}

export type ImageRef = { filename: string; subfolder: string; type: string };

export async function waitForJob(promptId: string, timeoutMs = 300_000): Promise<{ images: ImageRef[] }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await comfyFetch(`/history/${promptId}`);
    const hist = await r.json();
    const entry = hist[promptId];
    if (entry) {
      if (entry.status?.status_str === 'error') {
        throw new Error(`comfy job failed: ${JSON.stringify(entry.status?.messages ?? []).slice(0, 300)}`);
      }
      const images: ImageRef[] = [];
      for (const nodeOut of Object.values(entry.outputs ?? {}) as { images?: ImageRef[] }[]) {
        for (const img of nodeOut.images ?? []) images.push(img);
      }
      if (images.length) return { images };
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error('comfy job timed out');
}

export async function fetchImage(ref: ImageRef): Promise<Buffer> {
  const q = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type });
  const r = await comfyFetch(`/view?${q}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function uploadImage(filePath: string, name: string): Promise<{ name: string }> {
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(buf)], { type: 'image/png' }), name);
  form.append('overwrite', 'true');
  const r = await comfyFetch('/upload/image', { method: 'POST', body: form });
  return r.json();
}

export async function firstCheckpoint(): Promise<string> {
  const configured = getSettings().comfyCheckpoint;
  if (configured) return configured;
  const r = await comfyFetch('/object_info/CheckpointLoaderSimple');
  const info = await r.json();
  const choices: string[] = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
  if (!choices.length) throw new Error('no checkpoints installed in ComfyUI');
  return choices[0];
}

export async function saveWorkflowToDesktop(name: string, workflow: object): Promise<void> {
  try {
    const dir = getSettings().desktopWorkflowsDir;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(workflow, null, 2));
  } catch {
    // Desktop dir missing is non-fatal — job still ran.
  }
}
