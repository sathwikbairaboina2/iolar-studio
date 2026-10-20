import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gateDeps, indexCommand, renderCommand, stillCommand, tscCommand } from '@/lib/explainer2/commands';
import { renderVideo, videoHash } from '@/lib/explainer2/render';
import type { Timing } from '@/lib/explainer2/schema';

const TIMING: Timing = { fps: 30, totalFrames: 150, beats: [{ id: 'b1', start: 0, end: 75 }, { id: 'b2', start: 75, end: 150 }] };

let data: string;
let root: string;
beforeEach(() => {
  data = mkdtempSync(path.join(os.tmpdir(), 'x2-rd-'));
  root = mkdtempSync(path.join(os.tmpdir(), 'x2-rr-'));
  process.env.IOLAR_DATA_DIR = data;
});

describe('commands', () => {
  it('builds the index, tsc, still and render invocations', () => {
    expect(indexCommand()).toEqual({ cmd: 'node', args: ['scripts/designed-index.mjs'] });
    expect(tscCommand()).toEqual({ cmd: 'npx', args: ['tsc', '--noEmit'] });
    expect(stillCommand('caching', 'out/designed/caching/b1.png', 37)).toEqual({
      cmd: 'npx',
      args: ['remotion', 'still', 'src/index.ts', 'designed-caching', 'out/designed/caching/b1.png', '--frame=37'],
    });
    const r = renderCommand('caching', '/abs/out.mp4');
    expect(r.args.slice(0, 5)).toEqual(['remotion', 'render', 'src/index.ts', 'designed-caching', '/abs/out.mp4']);
    expect(r.args).toContain('--codec=h264');
  });
});

describe('gateDeps', () => {
  it('runs tsc and stills in the workspace, and keeps each still in the studio', async () => {
    const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
    const proc = vi.fn(async (cmd: string, args: string[], o: { cwd?: string }) => {
      calls.push({ cmd, args, cwd: o.cwd });
      const out = args.find((a) => a.endsWith('.png'));
      if (out) {
        await fs.mkdir(path.dirname(path.resolve(o.cwd!, out)), { recursive: true });
        await fs.writeFile(path.resolve(o.cwd!, out), 'png');
      }
      return { code: 0, output: '' };
    });
    await fs.mkdir(path.join(root, 'src', 'designed', 'videos', 'caching'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'designed', 'videos', 'caching', 'Video.tsx'), 'CODE');
    const d = gateDeps('caching', root, proc);
    expect(await d.readVideo()).toBe('CODE');
    expect((await d.tsc()).ok).toBe(true);
    expect((await d.still('b2', 110)).ok).toBe(true);
    expect(calls.every((c) => c.cwd === root)).toBe(true);
    expect(calls.some((c) => c.args.includes('designed-index.mjs') || c.args.includes('scripts/designed-index.mjs'))).toBe(true);
    expect(await fs.readFile(path.join(data, 'explainer-v2', 'caching', 'stills', 'b2.png'), 'utf8')).toBe('png');
  });
  it('reports a non-zero exit as a failure with its output', async () => {
    const proc = vi.fn(async (cmd: string) => (cmd === 'node' ? { code: 0, output: '' } : { code: 2, output: 'error TS1' }));
    const d = gateDeps('caching', root, proc);
    expect(await d.tsc()).toEqual({ ok: false, output: 'error TS1' });
  });
  it('reports a failed registration as a failed check', async () => {
    const proc = vi.fn(async () => ({ code: 1, output: 'no script' }));
    const r = await gateDeps('caching', root, proc).tsc();
    expect(r.ok).toBe(false);
    expect(r.output).toContain('no script');
  });
});

describe('renderVideo', () => {
  const seed = async () => {
    const studio = path.join(data, 'explainer-v2', 'caching');
    await fs.mkdir(path.join(studio, 'video'), { recursive: true });
    await fs.mkdir(path.join(studio, 'voice'), { recursive: true });
    await fs.writeFile(path.join(studio, 'video', 'Video.tsx'), 'CODE');
    await fs.writeFile(path.join(studio, 'timing.json'), JSON.stringify(TIMING));
    await fs.writeFile(path.join(studio, 'voice', 'b1.mp3'), 'v');
    return studio;
  };
  it('hashes the code and timing together', async () => {
    const studio = await seed();
    const a = await videoHash('caching');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    await fs.writeFile(path.join(studio, 'video', 'Video.tsx'), 'CODE2');
    expect(await videoHash('caching')).not.toBe(a);
  });
  it('hashes the music bed too, but a video with no sound.json keeps the old hash', async () => {
    const studio = await seed();
    const none = await videoHash('caching');
    await fs.writeFile(path.join(studio, 'sound.json'), JSON.stringify({ bed: 'music/a.mp3' }));
    const a = await videoHash('caching');
    expect(a).not.toBe(none);
    await fs.writeFile(path.join(studio, 'sound.json'), JSON.stringify({ bed: 'music/b.mp3' }));
    expect(await videoHash('caching')).not.toBe(a);
  });
  it('registers the video, renders the mp4 and a cover at the hook peak into the studio renders folder', async () => {
    const studio = await seed();
    const seen: string[][] = [];
    const proc = vi.fn(async (_cmd: string, args: string[], o: { cwd?: string }) => {
      seen.push(args);
      const out = args.find((a) => /\.(mp4|png)$/.test(a));
      if (out) {
        await fs.mkdir(path.dirname(path.resolve(o.cwd!, out)), { recursive: true });
        await fs.writeFile(path.resolve(o.cwd!, out), 'bytes');
      }
      return { code: 0, output: '' };
    });
    const id = await renderVideo('caching', { proc, root });
    expect(await fs.readFile(path.join(studio, 'renders', `${id}.mp4`), 'utf8')).toBe('bytes');
    expect(await fs.readFile(path.join(studio, 'renders', 'cover.png'), 'utf8')).toBe('bytes');
    expect(await fs.readFile(path.join(studio, 'renders', 'poster.png'), 'utf8')).toBe('bytes');
    expect(seen[0]).toEqual(['scripts/designed-index.mjs']);
    const cover = seen.find((a) => a[1] === 'still')!;
    expect(cover).toContain('--frame=48'); // the hook peak, 48 frames into the first beat
    expect(cover).toContain('out/designed/caching/cover.png');
    expect(await fs.readFile(path.join(root, 'public', 'designed', 'caching', 'b1.mp3'), 'utf8')).toBe('v');
  });
  it('throws with the output when the render fails', async () => {
    await seed();
    const proc = vi.fn(async (_c: string, args: string[]) => (args[1] === 'render' ? { code: 1, output: 'boom' } : { code: 0, output: '' }));
    await expect(renderVideo('caching', { proc, root })).rejects.toThrow(/boom/);
  });
});
