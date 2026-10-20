import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { explainer2File, explainer2RendersDir, explainer2VideoDir } from '@/lib/paths';
import { registerVideos, renderCommand, stillCommand, type Proc } from './commands';
import type { Timing } from './schema';
import { coverFrame } from './timing';
import { renderRoot, syncIn } from './workspace';

/** What an mp4 was made from: the code, the timing (the voice follows from it) and the music bed. A new hash is a new file. */
export async function videoHash(slug: string): Promise<string> {
  const code = await fs.readFile(path.join(explainer2VideoDir(slug), 'Video.tsx'));
  const timing = await fs.readFile(explainer2File(slug, 'timing.json'));
  // The chosen music bed is part of what the mp4 is made from: another bed is another file.
  const sound = await fs.readFile(explainer2File(slug, 'sound.json')).catch(() => Buffer.alloc(0));
  const hash = createHash('sha1').update(code).update('\0').update(timing);
  // A video with no sound.json (made before sound existed) hashes as it always did, so its render keeps its name.
  if (sound.length) hash.update('\0').update(sound);
  return hash.digest('hex').slice(0, 12);
}

export type RenderDeps = { proc: Proc; root?: string };

/**
 * Renders the mp4 (voice placed per beat by the video's own VoiceTrack) and the cover, a still at the hook's peak (the
 * frame where the after counter settles), into renders/<hash>.mp4, renders/cover.png and renders/poster.png (the same
 * picture, for what still asks for the poster). Returns the hash.
 */
export async function renderVideo(slug: string, deps: RenderDeps): Promise<string> {
  const root = deps.root ?? renderRoot();
  const w = await syncIn(slug, root);
  await registerVideos(root, deps.proc);
  const id = await videoHash(slug);
  const timing = JSON.parse(await fs.readFile(explainer2File(slug, 'timing.json'), 'utf8')) as Timing;

  await fs.mkdir(w.stillsDir, { recursive: true });
  const mp4 = path.join(w.stillsDir, `${id}.mp4`);
  const r = renderCommand(slug, mp4);
  const done = await deps.proc(r.cmd, r.args, { cwd: root, timeoutMs: 30 * 60_000 });
  if (done.code !== 0) throw new Error(`the render failed: ${done.output.trim().slice(-600)}`);

  const coverRel = `out/designed/${slug}/cover.png`;
  const p = stillCommand(slug, coverRel, coverFrame(timing));
  const still = await deps.proc(p.cmd, p.args, { cwd: root, timeoutMs: 300_000 });
  if (still.code !== 0) throw new Error(`the cover failed: ${still.output.trim().slice(-400)}`);

  await fs.mkdir(explainer2RendersDir(slug), { recursive: true });
  await fs.copyFile(mp4, path.join(explainer2RendersDir(slug), `${id}.mp4`));
  await fs.copyFile(path.resolve(root, coverRel), path.join(explainer2RendersDir(slug), 'cover.png'));
  await fs.copyFile(path.resolve(root, coverRel), path.join(explainer2RendersDir(slug), 'poster.png'));
  return id;
}
