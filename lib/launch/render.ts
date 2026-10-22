import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { launchAssetsDir, launchRendersDir, launchVoiceDir } from '@/lib/paths';
import type { Proc } from '@/lib/explainer2/commands';
import { renderRoot } from '@/lib/explainer2/workspace';
import { anchorPath, readAnchor } from './anchor';
import type { LaunchProps } from './edit';

export const LAUNCH_COMPOSITION = 'launch-reel';

export function launchWorkspace(root: string, slug: string) {
  const outDir = path.join(root, 'out', 'launch', slug);
  return { publicDir: path.join(root, 'public', 'launch', slug), outDir, propsFile: path.join(outDir, 'props.json') };
}

/** Studio -> workspace: the voice clips, the receipt pngs the scenes show, and the props. The studio stays the source of truth. */
export async function syncLaunchIn(slug: string, props: LaunchProps, root: string = renderRoot()): Promise<void> {
  const w = launchWorkspace(root, slug);
  await fs.rm(w.publicDir, { recursive: true, force: true });
  await fs.mkdir(w.publicDir, { recursive: true });
  await fs.mkdir(w.outDir, { recursive: true });
  for (const b of props.timing.beats) await fs.copyFile(path.join(launchVoiceDir(slug), `${b.id}.mp3`), path.join(w.publicDir, `${b.id}.mp3`));
  const copy = async (file: string) => fs.copyFile(path.join(launchAssetsDir(slug), path.basename(file)), path.join(w.publicDir, path.basename(file)));
  for (const s of props.scenes) {
    if (s.type === 'Receipt') await copy(s.image);
    else if (s.type === 'BRoll') await copy(s.image);
    else if (s.type === 'DemoClip') await copy(s.video);
    else if (s.type === 'AvatarTalk') {
      if (s.video) await copy(s.video);
      if (s.receipt) await copy(s.receipt.image);
      const anchor = await readAnchor();
      if (anchor) await fs.copyFile(anchorPath(anchor), path.join(w.publicDir, path.basename(s.portrait)));
    }
  }
  await fs.writeFile(w.propsFile, JSON.stringify(props));
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else out.push(p);
  }
  return out;
}

/** What the mp4 is made from: the props, the voice, and the look (the launch scenes and the captions). A new hash is a new file. */
export async function launchHash(props: LaunchProps, voiceDir: string, root: string = renderRoot()): Promise<string> {
  const h = createHash('sha1').update(JSON.stringify(props));
  for (const b of props.timing.beats) h.update('\0').update(await fs.readFile(path.join(voiceDir, `${b.id}.mp3`)));
  // A clip or photo made again under the same name is a different reel.
  for (const s of props.scenes) {
    const file = s.type === 'AvatarTalk' ? s.video : s.type === 'BRoll' ? s.image : s.type === 'DemoClip' ? s.video : null;
    if (file) h.update('\0').update(await fs.readFile(path.join(launchAssetsDir(props.slug), path.basename(file))).catch(() => ''));
  }
  const look = [...(await listFiles(path.join(root, 'src', 'launch'))), path.join(root, 'src', 'designed', 'kit', 'captions.ts')]
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
  for (const rel of look) {
    const body = await fs.readFile(path.join(root, rel)).catch(() => null);
    if (body) h.update('\0').update(rel).update('\0').update(body);
  }
  return h.digest('hex').slice(0, 12);
}

export const launchRenderCommand = (propsFile: string, out: string) => ({
  cmd: 'npx', args: ['remotion', 'render', 'src/index.ts', LAUNCH_COMPOSITION, out, `--props=${propsFile}`, '--codec=h264'],
});
const launchStillCommand = (propsFile: string, out: string, frame: number) => ({
  cmd: 'npx', args: ['remotion', 'still', 'src/index.ts', LAUNCH_COMPOSITION, out, `--props=${propsFile}`, `--frame=${frame}`],
});

export async function renderLaunch(slug: string, props: LaunchProps, deps: { proc: Proc; root?: string }): Promise<string> {
  const root = deps.root ?? renderRoot();
  await syncLaunchIn(slug, props, root);
  const w = launchWorkspace(root, slug);
  const id = await launchHash(props, launchVoiceDir(slug), root);
  const rel = (f: string) => path.relative(root, path.join(w.outDir, f)).split(path.sep).join('/');
  const r = launchRenderCommand(w.propsFile, rel(`${id}.mp4`));
  const done = await deps.proc(r.cmd, r.args, { cwd: root, timeoutMs: 30 * 60_000 });
  if (done.code !== 0) throw new Error(`the render failed: ${done.output.trim().slice(-600)}`);
  // The cover is the hook headline once it has settled.
  const s = launchStillCommand(w.propsFile, rel('cover.png'), Math.min(30, props.totalFrames - 1));
  const still = await deps.proc(s.cmd, s.args, { cwd: root, timeoutMs: 300_000 });
  if (still.code !== 0) throw new Error(`the cover failed: ${still.output.trim().slice(-400)}`);
  await fs.mkdir(launchRendersDir(slug), { recursive: true });
  await fs.copyFile(path.join(w.outDir, `${id}.mp4`), path.join(launchRendersDir(slug), `${id}.mp4`));
  await fs.copyFile(path.join(w.outDir, 'cover.png'), path.join(launchRendersDir(slug), 'cover.png'));
  return id;
}
