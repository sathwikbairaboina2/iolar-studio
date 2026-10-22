import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { launchAnchorDir, launchAnchorFile, launchRoot } from '@/lib/paths';
import type { Hf } from './higgsfield';

/**
 * The channel's face. It is fixed in data/launch/anchor.json: reels never generate a new one, they reference the locked
 * portrait. Changing it changes the face of every later reel.
 */

export const AnchorSchema = z.object({
  /** The Higgsfield image job the portrait came from; avatar clips reference it. */
  imageJobId: z.string().min(1),
  /** The portrait, relative to data/launch/. */
  file: z.string().min(1),
  prompt: z.string(),
  lockedAt: z.string(),
  /** An uploaded Higgsfield media id of the portrait, for models that take a media rather than a job id. Preferred when set. */
  startImage: z.string().min(1).optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const ANCHOR_PROMPT =
  'Candid vertical selfie-style photo of a 22-year-old Indian man, creator, looking into the camera mid-sentence with an expressive, slightly amused face, mouth relaxed and slightly open. Natural brown skin with visible pores, faint stubble, slight under-eye shadows, tousled black hair. Wearing an oversized washed charcoal tee. Sitting at a cluttered desk in a bedroom: open laptop with stickers on the lid, warm yellow fairy lights and a desk lamp, a soft ring light glow reflected in his eyes, a few band and tech stickers on the wall. Shot on a phone, shallow depth of field, slight grain, no retouching, plain real-life look. Head and shoulders centered in the lower two-thirds, empty space above for captions.';

export const PORTRAIT_FILE = 'anchor/portrait.png';
const JOB_ID = /^[A-Za-z0-9-]{8,64}$/;

export const anchorPath = (a: Anchor) => path.join(launchRoot(), a.file);
const candidatePath = (jobId: string) => path.join(launchAnchorDir(), 'candidates', `${jobId}.png`);

export async function readAnchor(): Promise<Anchor | null> {
  try {
    return AnchorSchema.parse(JSON.parse(await fs.readFile(launchAnchorFile(), 'utf8')));
  } catch {
    return null;
  }
}

export type Candidate = { jobId: string; url: string };

export async function listCandidates(): Promise<Candidate[]> {
  const names = await fs.readdir(path.join(launchAnchorDir(), 'candidates')).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith('.png')).map((n) => ({ jobId: n.slice(0, -4), url: `/api/launch/anchor/${n}` }));
}

/** Locks a proposed face: copies it to portrait.png and records it. A job id with no downloaded candidate is refused. */
export async function lockAnchor(jobId: string, prompt: string = ANCHOR_PROMPT, now: Date = new Date()): Promise<Anchor> {
  if (!JOB_ID.test(jobId)) throw new Error(`${jobId} is not a candidate`);
  const src = candidatePath(jobId);
  if (!(await fs.access(src).then(() => true, () => false))) throw new Error(`${jobId} is not a candidate; propose faces first`);
  await fs.mkdir(launchAnchorDir(), { recursive: true });
  await fs.copyFile(src, path.join(launchRoot(), PORTRAIT_FILE));
  const anchor: Anchor = { imageJobId: jobId, file: PORTRAIT_FILE, prompt, lockedAt: now.toISOString() };
  await fs.writeFile(launchAnchorFile(), JSON.stringify(anchor, null, 2));
  return anchor;
}

/** Four new faces from the portrait prompt (one image each, about 0.12 credits apiece), downloaded as candidates. */
export async function proposeAnchors(hf: Hf, prompt: string = ANCHOR_PROMPT, deps: { http?: typeof fetch } = {}): Promise<Candidate[]> {
  const http = deps.http ?? fetch;
  const ids = await Promise.all([0, 1, 2, 3].map(() => hf.generateImage({ kind: 'image', model: 'soul_2', aspect_ratio: '3:4', prompt })));
  const done = await hf.wait(ids, 10 * 60_000);
  await fs.mkdir(path.join(launchAnchorDir(), 'candidates'), { recursive: true });
  const out: Candidate[] = [];
  for (const jobId of ids) {
    const r = done[jobId];
    if (r?.status !== 'completed' || !r.url) continue;
    const res = await http(r.url);
    if (!res.ok) continue;
    await fs.writeFile(candidatePath(jobId), new Uint8Array(await res.arrayBuffer()));
    out.push({ jobId, url: `/api/launch/anchor/${jobId}.png` });
  }
  if (!out.length) throw new Error('Higgsfield made no usable faces; try again');
  return out;
}
