import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CRITERIA, CRITIC_TOOLS, PASS_SCORE, criticNotes, criticPrompt, critique, critiqueLoop, verdict, type Critic } from '@/lib/explainer2/critic';
import type { Script, Timing } from '@/lib/explainer2/schema';

const scores = (over: Partial<Record<(typeof CRITERIA)[number]['key'], number>> = {}) =>
  Object.fromEntries(CRITERIA.map((c) => [c.key, over[c.key] ?? 9])) as Critic['scores'];
const good: Critic = { scores: scores(), fixes: [] };
const bad = (fixes = ['Make the hook number bigger']): Critic => ({ scores: scores({ hook: 5, motion: 7 }), fixes });

const SCRIPT: Script = {
  title: 'Caching',
  hook: { before: { value: 30, unit: 'ms', label: 'DB' }, after: { value: 1, unit: 'ms', label: 'Cache' } },
  beats: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, caption: `C${i}`, narration: `Says ${i}.`, visual: `Shows ${i}` })),
  facts: [],
};
const TIMING: Timing = { fps: 30, totalFrames: 300, beats: [0, 1, 2, 3].map((i) => ({ id: `b${i + 1}`, start: i * 75, end: (i + 1) * 75 })) };

describe('verdict', () => {
  it('passes only when every score is 8 or more', () => {
    expect(PASS_SCORE).toBe(8);
    expect(verdict(good.scores)).toEqual({ pass: true, low: [] });
    expect(verdict(scores({ clean: 8 })).pass).toBe(true);
    expect(verdict(scores({ clean: 7 })).pass).toBe(false);
  });
  it('names the criteria that fell short', () => {
    expect(verdict(bad().scores).low).toEqual(['hook', 'motion']);
  });
  it('has the seven rubric items', () => expect(CRITERIA.map((c) => c.key)).toEqual(['hook', 'readable', 'motion', 'emphasis', 'clean', 'look', 'match']));
});

describe('critiqueLoop', () => {
  it('stops after one round when the scores pass', async () => {
    const crit = vi.fn(async () => good);
    const fix = vi.fn(async () => undefined);
    const r = await critiqueLoop({ critique: crit, fix });
    expect(crit).toHaveBeenCalledTimes(1);
    expect(fix).not.toHaveBeenCalled();
    expect(r).toMatchObject({ pass: true, scores: good.scores, fixes: [] });
    expect(r.rounds).toHaveLength(1);
  });
  it('runs one design round with the fixes, then critiques again, and passes', async () => {
    const answers = [bad(['Bigger number', 'Less empty space']), good];
    const crit = vi.fn(async () => answers.shift()!);
    const fix = vi.fn(async () => undefined);
    const r = await critiqueLoop({ critique: crit, fix });
    expect(crit).toHaveBeenCalledTimes(2);
    expect(fix).toHaveBeenCalledTimes(1);
    expect((fix.mock.calls[0] as unknown[])[0]).toEqual(['Bigger number', 'Less empty space']);
    expect(r.pass).toBe(true);
    expect(r.rounds.map((x) => x.pass)).toEqual([false, true]);
  });
  it('gives up after two critic rounds and records the failure, without a third', async () => {
    const crit = vi.fn(async () => bad());
    const fix = vi.fn(async () => undefined);
    const r = await critiqueLoop({ critique: crit, fix });
    expect(crit).toHaveBeenCalledTimes(2);
    expect(fix).toHaveBeenCalledTimes(1);
    expect(r.pass).toBe(false);
    expect(r.rounds).toHaveLength(2);
    expect(r.scores).toEqual(bad().scores);
  });
  it('honours a lower limit', async () => {
    const crit = vi.fn(async () => bad());
    await critiqueLoop({ critique: crit, fix: async () => undefined, maxRounds: 1 });
    expect(crit).toHaveBeenCalledTimes(1);
  });
});

describe('criticNotes', () => {
  it('turns the fixes into design notes, naming the low scores', () => {
    const t = criticNotes(bad(['Bigger number']).fixes, ['hook', 'motion']);
    expect(t).toContain('Bigger number');
    expect(t).toMatch(/hook/);
  });
});

describe('criticPrompt', () => {
  const strips = [{ beat: 'b1', file: '/w/out/b1.png' }, { beat: 'b2', file: '/w/out/b2.png' }];
  it('carries the rubric, the strips, the references, the script and the timing', () => {
    const p = criticPrompt({ script: SCRIPT, timing: TIMING, strips, references: ['/w/ref/a.png'] });
    for (const c of CRITERIA) expect(p).toContain(c.rule);
    expect(p).toContain('/w/out/b1.png');
    expect(p).toContain('/w/out/b2.png');
    expect(p).toContain('/w/ref/a.png');
    expect(p).toContain('Shows 3');
    expect(p).toMatch(/1 to 10/);
    expect(p).toMatch(/"scores"/);
    expect(p).toMatch(/6 frames/);
  });
  it('says so when there are no reference frames', () => {
    expect(criticPrompt({ script: SCRIPT, timing: TIMING, strips, references: [] })).toMatch(/no reference frames/i);
  });
});

describe('critique', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'x2-crit-'));
  });
  const strips = [{ beat: 'b1', file: '/w/b1.png' }];
  it('asks Opus with Read only and parses the scores', async () => {
    const run = vi.fn(async () => JSON.stringify(good));
    const r = await critique({ run, root }, { script: SCRIPT, timing: TIMING, strips });
    expect(r).toEqual(good);
    const opts = (run.mock.calls[0] as unknown[])[1] as { model: string; allowedTools: string[]; cwd: string };
    expect(opts.model).toBe('opus');
    expect(opts.allowedTools).toEqual(CRITIC_TOOLS);
    expect(CRITIC_TOOLS).toEqual(['Read']);
    expect(opts.cwd).toBe(root);
  });
  it('lists the reference frames it finds in the kit', async () => {
    const dir = path.join(root, 'src', 'designed', 'reference');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'course-1.png'), 'x');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'x');
    const run = vi.fn(async () => JSON.stringify(good));
    await critique({ run, root }, { script: SCRIPT, timing: TIMING, strips });
    const prompt = (run.mock.calls[0] as unknown[])[0] as string;
    expect(prompt).toContain('course-1.png');
    expect(prompt).not.toContain('notes.txt');
  });
  it('asks once more with its own error when the reply is not valid, then gives up', async () => {
    const run = vi.fn().mockResolvedValueOnce('not json').mockResolvedValueOnce(JSON.stringify(good));
    expect(await critique({ run, root }, { script: SCRIPT, timing: TIMING, strips })).toEqual(good);
    expect(run).toHaveBeenCalledTimes(2);
    expect((run.mock.calls[1] as unknown[])[0]).toMatch(/rejected/);
    const bad2 = vi.fn(async () => '{"scores":{"hook":11},"fixes":[]}');
    await expect(critique({ run: bad2, root }, { script: SCRIPT, timing: TIMING, strips })).rejects.toThrow(/critic/i);
    expect(bad2).toHaveBeenCalledTimes(2);
  });
});
