import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { syncIn, syncOut, workspacePaths } from '@/lib/explainer2/workspace';

let data: string;
let render: string;
beforeEach(() => {
  data = mkdtempSync(path.join(os.tmpdir(), 'x2-data-'));
  render = mkdtempSync(path.join(os.tmpdir(), 'x2-render-'));
  process.env.IOLAR_DATA_DIR = data;
});

describe('workspacePaths', () => {
  it('maps a slug into the render workspace', () => {
    const p = workspacePaths('/r', 'load-balancing');
    expect(p.videoDir).toBe(path.join('/r', 'src', 'designed', 'videos', 'load-balancing'));
    expect(p.videoFile).toBe(path.join('/r', 'src', 'designed', 'videos', 'load-balancing', 'Video.tsx'));
    expect(p.publicDir).toBe(path.join('/r', 'public', 'designed', 'load-balancing'));
    expect(p.stillsDir).toBe(path.join('/r', 'out', 'designed', 'load-balancing'));
    expect(p.indexScript).toBe(path.join('/r', 'scripts', 'designed-index.mjs'));
  });
  it('refuses a slug that could escape', () => {
    expect(() => workspacePaths('/r', '../evil')).toThrow();
  });
});

describe('syncIn / syncOut', () => {
  const seed = async () => {
    const studio = path.join(data, 'explainer-v2', 'caching');
    await fs.mkdir(path.join(studio, 'voice'), { recursive: true });
    await fs.mkdir(path.join(studio, 'video'), { recursive: true });
    await fs.writeFile(path.join(studio, 'voice', 'b1.mp3'), 'mp3-1');
    await fs.writeFile(path.join(studio, 'voice', 'b2.mp3'), 'mp3-2');
    await fs.writeFile(path.join(studio, 'brief.json'), '{"topic":"Caching"}');
    await fs.writeFile(path.join(studio, 'script.json'), '{"title":"T"}');
    await fs.writeFile(path.join(studio, 'timing.json'), '{"fps":30}');
    return studio;
  };

  it('copies voice, context and any existing Video.tsx into the workspace', async () => {
    const studio = await seed();
    await fs.writeFile(path.join(studio, 'video', 'Video.tsx'), 'old code');
    const p = await syncIn('caching', render);
    expect(await fs.readFile(p.videoFile, 'utf8')).toBe('old code');
    expect(await fs.readFile(path.join(p.publicDir, 'b2.mp3'), 'utf8')).toBe('mp3-2');
    expect(await fs.readFile(path.join(p.videoDir, 'timing.json'), 'utf8')).toBe('{"fps":30}');
    expect(await fs.readFile(path.join(p.videoDir, 'script.json'), 'utf8')).toBe('{"title":"T"}');
  });
  it('copies sound.json beside the video so it can import it', async () => {
    const studio = await seed();
    await fs.writeFile(path.join(studio, 'sound.json'), '{"bed":"music/a.mp3"}');
    const p = await syncIn('caching', render);
    expect(await fs.readFile(path.join(p.videoDir, 'sound.json'), 'utf8')).toBe('{"bed":"music/a.mp3"}');
  });
  it('works for a first design with no Video.tsx yet', async () => {
    await seed();
    const p = await syncIn('caching', render);
    await expect(fs.access(p.videoFile)).rejects.toThrow();
  });
  it('does not leave an old video behind when the studio has none', async () => {
    await seed();
    const p = workspacePaths(render, 'caching');
    await fs.mkdir(p.videoDir, { recursive: true });
    await fs.writeFile(p.videoFile, 'stale');
    await syncIn('caching', render);
    await expect(fs.access(p.videoFile)).rejects.toThrow();
  });
  it('copies Video.tsx back to the studio', async () => {
    await seed();
    const p = await syncIn('caching', render);
    await fs.writeFile(p.videoFile, 'new code');
    expect(await syncOut('caching', render)).toBe(true);
    expect(await fs.readFile(path.join(data, 'explainer-v2', 'caching', 'video', 'Video.tsx'), 'utf8')).toBe('new code');
  });
  it('reports false when the designer wrote nothing', async () => {
    await seed();
    await syncIn('caching', render);
    expect(await syncOut('caching', render)).toBe(false);
  });
});
