import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAUNCH_CRITERIA, LAUNCH_PASS, critiqueLaunch, launchCriticLoop, launchCriticNotes, launchCriticPrompt, launchStrips, launchVerdict, sceneFrames, type LaunchCritic,
} from '@/lib/launch/critic';
import type { LaunchProps } from '@/lib/launch/edit';
import { launchFile } from '@/lib/paths';

const keys = LAUNCH_CRITERIA.map((c) => c.key);
const scores = (over: Record<string, number> = {}) => Object.fromEntries(keys.map((k) => [k, over[k] ?? 9])) as LaunchCritic['scores'];
const good: LaunchCritic = { scores: scores(), fixes: [] };
const bad: LaunchCritic = { scores: scores({ hook: 5, pacing: 7 }), fixes: ['Make the headline move in the first second'] };

const props = {
  slug: 'gemini-4', fps: 30, width: 1080, height: 1920, totalFrames: 300, date: '21.10.26', bed: null, emphasis: [],
  timing: {
    fps: 30, totalFrames: 300,
    beats: [
      { id: 'hook', start: 0, end: 150, words: [{ w: 'Google', startFrame: 5, endFrame: 20 }, { w: 'did', startFrame: 21, endFrame: 30 }, { w: 'it', startFrame: 100, endFrame: 120 }] },
      { id: 'cta', start: 150, end: 300, words: [{ w: 'Follow', startFrame: 160, endFrame: 190 }] },
    ],
  },
  scenes: [
    { type: 'Headline', from: 0, to: 150, kicker: 'BREAKING', title: 'Gemini 4 is here.' },
    { type: 'DeltaCard', from: 150, to: 300, label: 'x', before: { value: 1, unit: '$' }, after: { value: 2, unit: '$' }, change: 'x', source: 'x' },
  ],
} as unknown as LaunchProps;
const script = { headline: 'Gemini 4 is here.', kicker: 'BREAKING', beats: [] } as never;

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-critic-'));
});

describe('rubric', () => {
  it('has the seven launch criteria and an 8 pass mark', () => {
    expect(keys).toEqual(['hook', 'readable', 'receipts', 'numbers', 'pacing', 'clean', 'look']);
    expect(LAUNCH_PASS).toBe(8);
  });
  it('passes only when every score is 8 or more and names the low ones', () => {
    expect(launchVerdict(good.scores)).toEqual({ pass: true, low: [] });
    expect(launchVerdict(scores({ look: 8 })).pass).toBe(true);
    expect(launchVerdict(bad.scores)).toEqual({ pass: false, low: ['hook', 'pacing'] });
  });
  it('turns fixes into notes naming the low criteria', () => {
    const n = launchCriticNotes(bad.fixes, ['hook']);
    expect(n).toMatch(/below 8.*hook/);
    expect(n).toContain('- Make the headline move');
  });
});

describe('sceneFrames', () => {
  it('spreads six frames from 2 after the start to 2 before the end', () => {
    const f = sceneFrames({ from: 60, to: 180 });
    expect(f).toHaveLength(6);
    expect(f[0]).toBe(62);
    expect(f.at(-1)).toBe(178);
    expect(f.every((v, i) => i === 0 || v > f[i - 1])).toBe(true);
  });
});

describe('launchStrips', () => {
  it('takes six frames per scene from the given mp4 and writes one strip per scene', async () => {
    const taken: { mp4: string; frame: number; fps: number }[] = [];
    const tiles: string[][] = [];
    const out = await launchStrips('gemini-4', props, '/r/second.mp4', {
      frame: async (mp4, frame, fps, file) => { taken.push({ mp4, frame, fps }); await fs.writeFile(file, 'f'); },
      tile: async (files, file) => { tiles.push(files); await fs.writeFile(file, 'strip'); },
    });
    expect(taken).toHaveLength(12);
    expect(taken.every((t) => t.mp4 === '/r/second.mp4' && t.fps === 30)).toBe(true);
    expect(tiles.map((t) => t.length)).toEqual([6, 6]);
    expect(out.map((s) => [s.scene, s.type, path.basename(s.file)])).toEqual([[0, 'Headline', '00-Headline.png'], [1, 'DeltaCard', '01-DeltaCard.png']]);
    expect(out[0].file).toBe(launchFile('gemini-4', path.join('strips', '00-Headline.png')));
    expect((await fs.readdir(launchFile('gemini-4', 'strips'))).sort()).toEqual(['00-Headline.png', '01-DeltaCard.png']);
  });

  it('clears the folder first, so no strip of an earlier round is left', async () => {
    await fs.mkdir(launchFile('gemini-4', 'strips'), { recursive: true });
    await fs.writeFile(launchFile('gemini-4', path.join('strips', '09-Old.png')), 'old');
    await launchStrips('gemini-4', props, '/r/a.mp4', { frame: async (_m, _f, _p, file) => fs.writeFile(file, 'f'), tile: async (_f, file) => fs.writeFile(file, 's') });
    expect(await fs.readdir(launchFile('gemini-4', 'strips'))).not.toContain('09-Old.png');
  });
});

describe('launchCriticPrompt', () => {
  const strips = [{ scene: 0, type: 'Headline', file: '/d/strips/00-Headline.png' }, { scene: 1, type: 'DeltaCard', file: '/d/strips/01-DeltaCard.png' }];
  it('lists every strip, every criterion, and what is spoken during each scene', () => {
    const p = launchCriticPrompt({ script, props, strips });
    for (const s of strips) expect(p).toContain(s.file);
    for (const k of keys) expect(p).toContain(k);
    expect(p).toContain('You review a news reel');
    expect(p).toMatch(/Headline.*5\.0 s.*Google did it/);
    expect(p).toMatch(/Follow/);
  });
});

describe('critiqueLaunch', () => {
  it('retries once with the validation error quoted, then succeeds', async () => {
    const { receipts: _dropped, ...partial } = scores();
    const prompts: string[] = [];
    const opts: unknown[] = [];
    const run = vi.fn(async (p: string, o?: unknown) => {
      prompts.push(p);
      opts.push(o);
      return JSON.stringify(prompts.length === 1 ? { scores: partial, fixes: [] } : good);
    });
    const c = await critiqueLaunch({ run: run as never }, { script, props, strips: [] });
    expect(c).toEqual(good);
    expect(run).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toMatch(/rejected[\s\S]*receipts/);
    expect(opts[0]).toMatchObject({ model: 'opus', allowedTools: ['Read'], timeoutMs: 600_000 });
  });

  it('rejects scores outside 0 to 10, and fails after the retry with the answer quoted', async () => {
    const run = vi.fn(async () => JSON.stringify({ scores: scores({ hook: 11 }), fixes: [] }));
    await expect(critiqueLaunch({ run }, { script, props, strips: [] })).rejects.toThrow(/did not return valid scores[\s\S]*"hook":11/);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('launchCriticLoop', () => {
  it('stops after a passing round', async () => {
    const critique = vi.fn(async () => good);
    const fix = vi.fn(async () => undefined);
    const r = await launchCriticLoop({ critique, fix });
    expect(critique).toHaveBeenCalledTimes(1);
    expect(fix).not.toHaveBeenCalled();
    expect(r.pass).toBe(true);
  });
  it('fixes once between two failing rounds and never runs a third', async () => {
    const critique = vi.fn(async () => bad);
    const fix = vi.fn(async (_f: string[], _l: string[]) => undefined);
    const r = await launchCriticLoop({ critique, fix, maxRounds: 5 });
    expect(critique).toHaveBeenCalledTimes(2);
    expect(fix).toHaveBeenCalledTimes(1);
    expect(fix.mock.calls[0]).toEqual([bad.fixes, ['hook', 'pacing']]);
    expect(r.pass).toBe(false);
    expect(r.rounds).toHaveLength(2);
    expect(r.fixes).toEqual(bad.fixes);
  });
  it('passes on the second round after a fix', async () => {
    const critique = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
    const r = await launchCriticLoop({ critique, fix: async () => undefined });
    expect(r.pass).toBe(true);
    expect(r.rounds.map((x) => x.pass)).toEqual([false, true]);
  });
});
