import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { explainer2StillsDir } from '@/lib/paths';
import type { GateDeps } from './gates';
import { workspacePaths } from './workspace';

/** A process run in the Remotion workspace: exit code and everything it printed. */
export type Proc = (cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number }) => Promise<{ code: number; output: string }>;

/**
 * Runs a fixed command. `npx` is a .cmd shim on Windows, which needs a shell; every argument here is built
 * by this module from a validated slug and a number, never from user text.
 */
export const runProc: Proc = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, shell: process.platform === 'win32', windowsHide: true });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${cmd} ${args.slice(0, 2).join(' ')} timed out after ${opts.timeoutMs ?? 600_000}ms`));
    }, opts.timeoutMs ?? 600_000);
    child.stdout?.on('data', (d) => { output += d.toString(); });
    child.stderr?.on('data', (d) => { output += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, output }); });
  });

export type Command = { cmd: string; args: string[] };

export const indexCommand = (): Command => ({ cmd: 'node', args: ['scripts/designed-index.mjs'] });
export const tscCommand = (): Command => ({ cmd: 'npx', args: ['tsc', '--noEmit'] });
export const stillCommand = (slug: string, out: string, frame: number): Command => ({
  cmd: 'npx',
  args: ['remotion', 'still', 'src/index.ts', `designed-${slug}`, out, `--frame=${frame}`],
});
export const renderCommand = (slug: string, out: string): Command => ({
  cmd: 'npx',
  args: ['remotion', 'render', 'src/index.ts', `designed-${slug}`, out, '--codec=h264'],
});

/** Regenerates src/designed/index.ts so the workspace knows every video in videos/. */
export async function registerVideos(root: string, proc: Proc): Promise<void> {
  const { cmd, args } = indexCommand();
  const r = await proc(cmd, args, { cwd: root, timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`could not register the videos: ${r.output.slice(-400)}`);
}

/** What the gates need from the workspace: the code, a type check, and a still per beat (each also kept in the studio). */
export function gateDeps(slug: string, root: string, proc: Proc): GateDeps {
  const w = workspacePaths(root, slug);
  let registered: Promise<void> | null = null;
  const register = () => (registered ??= registerVideos(root, proc));
  return {
    slug,
    readVideo: () => fs.readFile(w.videoFile, 'utf8'),
    async tsc() {
      try {
        await register();
        const { cmd, args } = tscCommand();
        const r = await proc(cmd, args, { cwd: root, timeoutMs: 300_000 });
        return { ok: r.code === 0, output: r.output };
      } catch (err) {
        return { ok: false, output: String(err instanceof Error ? err.message : err) };
      }
    },
    async still(beatId, frame) {
      try {
        await register();
        const rel = `out/designed/${slug}/${beatId}.png`;
        const { cmd, args } = stillCommand(slug, rel, frame);
        const r = await proc(cmd, args, { cwd: root, timeoutMs: 300_000 });
        if (r.code !== 0) return { ok: false, output: r.output };
        await fs.mkdir(explainer2StillsDir(slug), { recursive: true });
        await fs.copyFile(path.resolve(root, rel), path.join(explainer2StillsDir(slug), `${beatId}.png`));
        return { ok: true, output: r.output };
      } catch (err) {
        return { ok: false, output: String(err instanceof Error ? err.message : err) };
      }
    },
  };
}
