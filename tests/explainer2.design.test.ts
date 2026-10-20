import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DESIGN_TOOLS, designPrompt, runDesign } from '@/lib/explainer2/design';
import type { Brief, Script, Timing } from '@/lib/explainer2/schema';

const BRIEF: Brief = { topic: 'Caching', audience: 'engineers', claim: 'Caches trade freshness for speed', seconds: 30 };
const beat = (i: number) => ({ id: `b${i}`, caption: `Caption ${i}`, narration: `Narration ${i}.`, visual: `Visual ${i} happens` });
const SCRIPT: Script = {
  title: 'Why caching feels instant',
  hook: { before: { value: 800, unit: 'ms', label: 'Without' }, after: { value: 20, unit: 'ms', label: 'With' } },
  beats: [1, 2, 3, 4].map(beat),
  facts: [],
};
const TIMING: Timing = { fps: 30, totalFrames: 300, beats: [0, 1, 2, 3].map((i) => ({ id: `b${i + 1}`, start: i * 75, end: (i + 1) * 75 })) };
const base = { slug: 'caching', brief: BRIEF, script: SCRIPT, timing: TIMING, readme: 'KIT README TEXT', existing: null as string | null };

describe('designPrompt', () => {
  it('carries the brief, script, timing, kit README and the rules', () => {
    const p = designPrompt(base);
    for (const s of ['Caching', 'Caches trade freshness for speed', 'Visual 3 happens', '"totalFrames": 300', 'KIT README TEXT']) expect(p).toContain(s);
    expect(p).toContain('src/designed/videos/caching/Video.tsx');
    expect(p).toContain('designed-caching');
    expect(p).toMatch(/at most 4 rounds/i);
    expect(p).toMatch(/npx tsc/);
    expect(p).toMatch(/npx remotion still/);
    expect(p).toMatch(/40 ?px/);
    expect(p).not.toMatch(/36 ?px/);
    expect(p).toMatch(/Math\.random/);
    expect(p).toContain('--frame=37'); // the middle of beat 1
    expect(p).toContain('RequestJourney');
  });
  it('asks for the max parts: moving hook, karaoke captions, camera, sound, end card, json imports', () => {
    const p = designPrompt({ ...base, sound: 'Music beds in the library: music/calm-1.mp3', bed: 'music/calm-1.mp3' });
    for (const s of ['DeltaHook', 'handoffAt', 'KaraokeCaption', 'ProgressDots', 'Camera', 'EndCard', 'SoundTrack', 'Sfx', 'MaxShowcase', "import timing from './timing.json'", "import sound from './sound.json'"]) expect(p).toContain(s);
    expect(p).toContain('music/calm-1.mp3');
    expect(p).toMatch(/more than one sound in any 6 frames/);
    expect(p).toContain('hook-4.png');
  });
  it('asks for a still just after each beat starts, from b2 on, and for the beat change to land on its first word', () => {
    const p = designPrompt(base);
    expect(p).not.toContain('b1-in.png');
    expect(p).toContain('out/designed/caching/b2-in.png --frame=85');
    expect(p).toContain('out/designed/caching/b3-in.png --frame=160');
    expect(p).toContain('out/designed/caching/b4-in.png --frame=235');
    expect(p).toMatch(/start \+ 9/);
    expect(p).toMatch(/hold the final layout through the last frame/);
  });
  it('lists the emphasis words of the script for the captions', () => {
    const s = { ...SCRIPT, beats: SCRIPT.beats.map((b, i) => (i === 0 ? { ...b, emphasis: ['30 ms'] } : b)) };
    expect(designPrompt({ ...base, script: s })).toContain('emphasis={["30 ms"]}');
  });
  it('shows the word timings as a count, not the list', () => {
    const t: Timing = { ...TIMING, beats: TIMING.beats.map((b) => ({ ...b, words: [{ w: 'hello', startFrame: b.start, endFrame: b.start + 5 }] })) };
    const p = designPrompt({ ...base, timing: t });
    expect(p).toContain('1 words (in timing.json)');
    expect(p).not.toContain('"hello"');
  });
  it('points the designer at the motion strips when it has them', () => {
    const p = designPrompt({ ...base, strips: [{ beat: 'b1', file: '/w/out/designed/caching/strips/b1.png' }] });
    expect(p).toContain('/w/out/designed/caching/strips/b1.png');
    expect(p).toMatch(/6 frames evenly spaced/);
    expect(designPrompt(base)).not.toMatch(/Motion strips of the current version/);
  });
  it('shows the existing code and the notes when revising, and gate errors when asked to fix them', () => {
    const p = designPrompt({ ...base, existing: 'export default function Old() {}', notes: 'Make the packets bigger', gateErrors: ['uses Date: nope'] });
    expect(p).toContain('export default function Old() {}');
    expect(p).toContain('Make the packets bigger');
    expect(p).toContain('uses Date: nope');
    expect(p).toMatch(/edit the existing/i);
  });
});

describe('DESIGN_TOOLS', () => {
  it('has the file tools, tsc and remotion still, and nothing like a general shell or the network', () => {
    expect(DESIGN_TOOLS).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(npx tsc:*)', 'Bash(npx remotion still:*)']));
    expect(DESIGN_TOOLS).not.toContain('Bash');
    expect(DESIGN_TOOLS.some((t) => /Web/.test(t))).toBe(false);
    expect(DESIGN_TOOLS.filter((t) => t.startsWith('Bash(')).every((t) => /npx tsc|npx remotion still|designed-index/.test(t))).toBe(true);
  });
});

describe('runDesign', () => {
  let data: string;
  let root: string;
  beforeEach(() => {
    data = mkdtempSync(path.join(os.tmpdir(), 'x2-d-'));
    root = mkdtempSync(path.join(os.tmpdir(), 'x2-r-'));
    process.env.IOLAR_DATA_DIR = data;
  });

  it('syncs in, runs opus in the workspace with the tools, and syncs Video.tsx back', async () => {
    const studio = path.join(data, 'explainer-v2', 'caching');
    await fs.mkdir(studio, { recursive: true });
    await fs.writeFile(path.join(studio, 'brief.json'), JSON.stringify(BRIEF));
    await fs.writeFile(path.join(studio, 'script.json'), JSON.stringify(SCRIPT));
    await fs.writeFile(path.join(studio, 'timing.json'), JSON.stringify(TIMING));
    await fs.mkdir(path.join(root, 'src', 'designed', 'kit'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'designed', 'kit', 'README.md'), 'THE README');

    const run = vi.fn(async () => {
      await fs.writeFile(path.join(root, 'src', 'designed', 'videos', 'caching', 'Video.tsx'), 'export default 1');
      return 'done';
    });
    const r = await runDesign('caching', { run, root });
    expect(r.wrote).toBe(true);
    const [prompt, opts] = run.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(prompt).toContain('THE README');
    expect(opts.cwd).toBe(root);
    expect(opts.model).toBe('opus');
    expect(opts.allowedTools).toEqual(DESIGN_TOOLS);
    expect(opts.permissionMode).toBe('acceptEdits');
    expect(opts.timeoutMs).toBeGreaterThanOrEqual(900_000);
    expect(await fs.readFile(path.join(studio, 'video', 'Video.tsx'), 'utf8')).toBe('export default 1');
  });

  it('picks a music bed from the library into sound.json, once, and keeps a bed a person chose', async () => {
    const studio = path.join(data, 'explainer-v2', 'caching');
    await fs.mkdir(studio, { recursive: true });
    await fs.writeFile(path.join(studio, 'brief.json'), JSON.stringify(BRIEF));
    await fs.writeFile(path.join(studio, 'script.json'), JSON.stringify(SCRIPT));
    await fs.writeFile(path.join(studio, 'timing.json'), JSON.stringify(TIMING));
    await fs.mkdir(path.join(root, 'public', 'designed', '_audio'), { recursive: true });
    await fs.writeFile(path.join(root, 'public', 'designed', '_audio', 'manifest.json'), JSON.stringify({ files: [{ file: 'music/calm-1.mp3', kind: 'music', mood: 'calm' }] }));
    const run = vi.fn(async () => 'done');
    await runDesign('caching', { run, root });
    expect(JSON.parse(await fs.readFile(path.join(studio, 'sound.json'), 'utf8'))).toEqual({ bed: 'music/calm-1.mp3' });
    expect(await fs.readFile(path.join(root, 'src', 'designed', 'videos', 'caching', 'sound.json'), 'utf8')).toContain('calm-1');
    expect((run.mock.calls[0] as unknown as [string])[0]).toContain('music/calm-1.mp3');
    await fs.writeFile(path.join(studio, 'sound.json'), JSON.stringify({ bed: null }));
    await runDesign('caching', { run, root });
    expect(JSON.parse(await fs.readFile(path.join(studio, 'sound.json'), 'utf8'))).toEqual({ bed: null });
  });

  it('reports wrote:false when the model leaves no Video.tsx', async () => {
    const studio = path.join(data, 'explainer-v2', 'caching');
    await fs.mkdir(studio, { recursive: true });
    await fs.writeFile(path.join(studio, 'brief.json'), JSON.stringify(BRIEF));
    await fs.writeFile(path.join(studio, 'script.json'), JSON.stringify(SCRIPT));
    await fs.writeFile(path.join(studio, 'timing.json'), JSON.stringify(TIMING));
    const r = await runDesign('caching', { run: vi.fn().mockResolvedValue('nothing'), root });
    expect(r.wrote).toBe(false);
  });
});
