import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { frameNumber, renderStrips, sequenceCommand, stripFrames, tileFrames } from '@/lib/explainer2/strips';
import type { Timing } from '@/lib/explainer2/schema';

const TIMING: Timing = { fps: 30, totalFrames: 150, beats: [{ id: 'b1', start: 0, end: 75 }, { id: 'b2', start: 75, end: 150 }] };

let data: string;
let root: string;
beforeEach(() => {
  data = mkdtempSync(path.join(os.tmpdir(), 'x2-st-'));
  root = mkdtempSync(path.join(os.tmpdir(), 'x2-str-'));
  process.env.IOLAR_DATA_DIR = data;
});

describe('stripFrames', () => {
  it('is six frames evenly spaced from the first to the last of the beat', () => {
    expect(stripFrames({ start: 0, end: 76 })).toEqual([0, 15, 30, 45, 60, 75]);
    const f = stripFrames({ start: 100, end: 221 });
    expect(f).toHaveLength(6);
    expect(f[0]).toBe(100);
    expect(f[5]).toBe(220);
    for (let i = 1; i < 6; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
  });
  it('stays inside a very short beat, without repeating a frame needlessly', () => {
    const f = stripFrames({ start: 10, end: 13 });
    expect(Math.min(...f)).toBe(10);
    expect(Math.max(...f)).toBe(12);
  });
});

describe('sequenceCommand and frameNumber', () => {
  it('renders an image sequence at half size', () => {
    const c = sequenceCommand('caching', 'out/designed/caching/seq');
    expect(c.args.slice(0, 5)).toEqual(['remotion', 'render', 'src/index.ts', 'designed-caching', 'out/designed/caching/seq']);
    expect(c.args).toEqual(expect.arrayContaining(['--sequence', '--scale=0.5']));
  });
  it('reads the frame number out of a sequence file name', () => {
    expect(frameNumber('element-0042.png')).toBe(42);
    expect(frameNumber('element-007.jpeg')).toBe(7);
    expect(frameNumber('notes.txt')).toBeNull();
  });
});

describe('tileFrames', () => {
  it('lays the frames out three across and writes one png', async () => {
    const files: string[] = [];
    for (let i = 0; i < 6; i++) {
      const f = path.join(root, `f${i}.png`);
      await sharp({ create: { width: 54, height: 96, channels: 3, background: { r: i * 40, g: 0, b: 0 } } }).png().toFile(f);
      files.push(f);
    }
    const out = path.join(root, 'tile', 'b1.png');
    await tileFrames(files, out);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(54 * 3);
    expect(meta.height).toBe(96 * 2);
  });
});

describe('renderStrips', () => {
  const seed = async () => {
    await fs.mkdir(path.join(root, 'src', 'designed', 'videos', 'caching'), { recursive: true });
  };
  it('renders one sequence, tiles six frames per beat and keeps the strips in the studio', async () => {
    await seed();
    const proc = vi.fn(async (_c: string, args: string[], o: { cwd?: string }) => {
      if (args[1] === 'render') {
        const dir = path.resolve(o.cwd!, args[4]);
        await fs.mkdir(dir, { recursive: true });
        for (let f = 0; f < 150; f++) await fs.writeFile(path.join(dir, `element-${String(f).padStart(3, '0')}.png`), 'x');
      }
      return { code: 0, output: '' };
    });
    const tiled: { files: string[]; out: string }[] = [];
    const tile = vi.fn(async (files: string[], out: string) => {
      tiled.push({ files, out });
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, 'strip');
    });
    const strips = await renderStrips('caching', TIMING, { proc, root, tile });
    expect(strips.map((s) => s.beat)).toEqual(['b1', 'b2']);
    expect(tiled).toHaveLength(2);
    expect(tiled[0].files.map((f) => path.basename(f))).toEqual(['element-000.png', 'element-015.png', 'element-030.png', 'element-044.png', 'element-059.png', 'element-074.png']);
    expect(tiled[1].files[0]).toMatch(/element-075\.png$/);
    expect(await fs.readFile(path.join(data, 'explainer-v2', 'caching', 'strips', 'b1.png'), 'utf8')).toBe('strip');
    // The workspace copy is the one the critic reads, and the big sequence is cleaned up.
    expect(strips[0].file).toBe(path.join(root, 'out', 'designed', 'caching', 'strips', 'b1.png'));
    await expect(fs.access(path.join(root, 'out', 'designed', 'caching', 'seq'))).rejects.toThrow();
  });
  it('throws with the output when the sequence render fails', async () => {
    await seed();
    const proc = vi.fn(async (_c: string, args: string[]) => (args[1] === 'render' ? { code: 1, output: 'boom' } : { code: 0, output: '' }));
    await expect(renderStrips('caching', TIMING, { proc, root, tile: async () => undefined })).rejects.toThrow(/boom/);
  });
  it('uses the nearest frame that exists when the sequence is missing one', async () => {
    await seed();
    const proc = vi.fn(async (_c: string, args: string[], o: { cwd?: string }) => {
      if (args[1] === 'render') {
        const dir = path.resolve(o.cwd!, args[4]);
        await fs.mkdir(dir, { recursive: true });
        for (const f of [0, 74, 75, 149]) await fs.writeFile(path.join(dir, `element-${String(f).padStart(3, '0')}.png`), 'x');
      }
      return { code: 0, output: '' };
    });
    const tile = vi.fn(async (files: string[], out: string) => { await fs.mkdir(path.dirname(out), { recursive: true }); await fs.writeFile(out, String(files.length)); });
    await renderStrips('caching', TIMING, { proc, root, tile });
    expect(tile.mock.calls[0][0]).toHaveLength(6);
  });
});
