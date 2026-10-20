import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExplainer, listExplainers, readCritic, readJob, readScript, readFactcheck } from '@/lib/explainer2/store';
import { changeBed, nextStage, overrideFacts, reviseJob, runJob, type JobDeps } from '@/lib/explainer2/job';
import { CRITERIA } from '@/lib/explainer2/critic';
import { readSound } from '@/lib/explainer2/sound';
import type { Brief } from '@/lib/explainer2/schema';

const BRIEF: Brief = { topic: 'Load balancing', audience: 'engineers', claim: 'A balancer spreads load', seconds: 30 };
const beat = (i: number, n = `Narration ${i} says one thing.`) => ({ id: `b${i}`, caption: `Caption ${i}`, narration: n, visual: `Visual ${i}` });
const script = (title = 'Spread the load') => ({
  title,
  hook: { before: { value: 900, unit: 'ms', label: 'One server' }, after: { value: 90, unit: 'ms', label: 'Four servers' } },
  beats: [1, 2, 3, 4].map((i) => beat(i)),
  facts: ['Round robin sends requests in turn.'],
});
const GOOD_VIDEO = `import { Stage } from '../../kit'
export const meta = { id: 'designed-x', durationInFrames: TOTAL, fps: 30, width: 1080, height: 1920 }
export default function V() { return <Stage>{null}</Stage> }
`;

let data: string;
let root: string;
beforeEach(() => {
  data = mkdtempSync(path.join(os.tmpdir(), 'x2-job-'));
  root = mkdtempSync(path.join(os.tmpdir(), 'x2-jobr-'));
  process.env.IOLAR_DATA_DIR = data;
});

/** Deps made of canned answers; `calls` records which stage asked. */
const scoresOf = (n: number, low: Record<string, number> = {}) => ({ scores: Object.fromEntries(CRITERIA.map((c) => [c.key, low[c.key] ?? n])), fixes: Object.keys(low).length ? ['Make the hook number bigger'] : [] });
const GOOD_CRITIC = scoresOf(9);
const BAD_CRITIC = scoresOf(9, { hook: 5 });

function harness(over: { facts?: unknown[]; scripts?: unknown[]; badDesign?: number; tsc?: number[]; critics?: unknown[]; probeSeconds?: number[] } = {}) {
  const calls: string[] = [];
  const facts = over.facts ?? [{ ok: true, issues: [] }];
  const scripts = over.scripts ?? [script()];
  let badDesign = over.badDesign ?? 0;
  const critics = over.critics ?? [GOOD_CRITIC];
  const run = vi.fn(async (prompt: string, opts: { allowedTools?: string[] } = {}) => {
    if (opts.allowedTools?.length === 1 && opts.allowedTools[0] === 'Read') {
      calls.push('critic');
      return JSON.stringify(critics.length > 1 ? critics.shift() : critics[0]);
    }
    if (opts.allowedTools?.includes('WebSearch')) {
      calls.push('factcheck');
      const r = facts.length > 1 ? facts.shift() : facts[0];
      return JSON.stringify(r);
    }
    if (opts.allowedTools?.includes('Write')) {
      calls.push('design');
      const timing = JSON.parse(await fs.readFile(path.join(root, 'src', 'designed', 'videos', 'load-balancing', 'timing.json'), 'utf8'));
      const total = badDesign > 0 ? timing.totalFrames + 1 : timing.totalFrames;
      if (badDesign > 0) badDesign -= 1;
      await fs.writeFile(path.join(root, 'src', 'designed', 'videos', 'load-balancing', 'Video.tsx'), GOOD_VIDEO.replace('TOTAL', String(total)));
      return 'designed';
    }
    calls.push('script');
    const r = scripts.length > 1 ? scripts.shift() : scripts[0];
    return JSON.stringify(r);
  });
  const speak = vi.fn(async (_t: string, mp3: string) => {
    calls.push('voice');
    await fs.mkdir(path.dirname(mp3), { recursive: true });
    await fs.writeFile(mp3, 'mp3');
    return { provider: 'kokoro' as const };
  });
  const seconds = over.probeSeconds ?? [];
  const probe = vi.fn(async () => seconds.shift() ?? 3);
  const tscOk = over.tsc ?? [];
  const proc = vi.fn(async (_c: string, args: string[], o: { cwd?: string }) => {
    if (args[0] === 'tsc') {
      calls.push('tsc');
      return tscOk.shift() === 1 ? { code: 1, output: 'error TS1' } : { code: 0, output: '' };
    }
    if (args.includes('--sequence')) {
      calls.push('strips');
      const dir = path.resolve(o.cwd!, args[4]);
      await fs.mkdir(dir, { recursive: true });
      for (let f = 0; f < 600; f++) await fs.writeFile(path.join(dir, `element-${String(f).padStart(3, '0')}.png`), 'f');
      return { code: 0, output: '' };
    }
    const out = args.find((a) => /\.(png|mp4)$/.test(a));
    if (out) {
      calls.push(args[1]);
      await fs.mkdir(path.dirname(path.resolve(o.cwd!, out)), { recursive: true });
      await fs.writeFile(path.resolve(o.cwd!, out), 'bytes');
    }
    return { code: 0, output: '' };
  });
  const tile = vi.fn(async (_files: string[], out: string) => {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, 'strip');
  });
  const deps: JobDeps = { run, speak, probe, proc, tile, root, now: () => new Date('2026-10-19T10:00:00Z') };
  return { deps, calls, run, speak, proc, tile, probe };
}

describe('store', () => {
  it('creates a folder per explainer with a unique slug, and lists it', async () => {
    const a = await createExplainer(BRIEF, new Date('2026-10-19T10:00:00Z'));
    const b = await createExplainer(BRIEF, new Date('2026-10-19T10:00:00Z'));
    expect(a).toBe('load-balancing');
    expect(b).toBe('load-balancing-2');
    expect((await readJob(a))!.stages.brief.status).toBe('done');
    const list = await listExplainers();
    expect(list.map((r) => r.slug).sort()).toEqual(['load-balancing', 'load-balancing-2']);
    expect(list[0].topic).toBe('Load balancing');
  });
});

describe('nextStage', () => {
  it('is the first stage that is not done', async () => {
    const slug = await createExplainer(BRIEF);
    expect(nextStage((await readJob(slug))!)).toBe('script');
  });
});

describe('runJob', () => {
  it('runs every stage in order and leaves a render', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness();
    const job = await runJob(slug, h.deps);
    expect(job.stages.render.status).toBe('done');
    expect(Object.values(job.stages).every((s) => s.status === 'done')).toBe(true);
    expect(h.calls.filter((c) => c === 'script' || c === 'factcheck' || c === 'voice' || c === 'design').slice(0, 2)).toEqual(['script', 'factcheck']);
    expect(h.calls.indexOf('voice')).toBeGreaterThan(h.calls.indexOf('factcheck'));
    expect(h.calls.indexOf('design')).toBeGreaterThan(h.calls.indexOf('voice'));
    expect(h.calls.indexOf('render')).toBeGreaterThan(h.calls.indexOf('design'));
    expect(job.renderId).toMatch(/^[0-9a-f]{12}$/);
    await expect(fs.access(path.join(data, 'explainer-v2', slug, 'renders', `${job.renderId}.mp4`))).resolves.toBeUndefined();
  });

  it('resumes: a second run does nothing, and a failed stage is retried without redoing earlier ones', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness();
    await runJob(slug, h.deps);
    const before = h.run.mock.calls.length;
    await runJob(slug, h.deps);
    expect(h.run.mock.calls.length).toBe(before);

    // Break the voice stage on a fresh explainer: script and fact check are kept.
    const slug2 = await createExplainer({ ...BRIEF, topic: 'Rate limiting' });
    const h2 = harness();
    h2.deps.speak = vi.fn().mockRejectedValue(new Error('kokoro down'));
    const failed = await runJob(slug2, h2.deps);
    expect(failed.stages.voice.status).toBe('failed');
    expect(failed.stages.voice.error).toContain('kokoro down');
    expect(failed.stages.script.status).toBe('done');
    expect(failed.stages.design.status).toBe('pending');
  });

  it('rewrites once on fact-check issues, and carries on when the second check is clean', async () => {
    const slug = await createExplainer(BRIEF);
    const issue = { ok: false, issues: [{ beat: 'b2', claim: 'zero latency', correction: 'nothing is zero' }] };
    const h = harness({ facts: [issue, { ok: true, issues: [] }], scripts: [script('First draft'), script('Second draft')] });
    const job = await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'script')).toHaveLength(2);
    expect(h.calls.filter((c) => c === 'factcheck')).toHaveLength(2);
    expect((await readScript(slug))!.title).toBe('Second draft');
    // The rewrite was told what was wrong.
    const rewrite = h.run.mock.calls.filter(([, o]) => !(o as { allowedTools?: string[] }).allowedTools)[1][0];
    expect(rewrite).toContain('nothing is zero');
    expect(job.stages.render.status).toBe('done');
  });

  it('blocks at the fact check when issues survive, and rendering needs an override', async () => {
    const slug = await createExplainer(BRIEF);
    const issue = { ok: false, issues: [{ beat: 'b2', claim: 'zero latency', correction: 'nothing is zero' }] };
    const h = harness({ facts: [issue] });
    const job = await runJob(slug, h.deps);
    expect(job.stages.factcheck.status).toBe('blocked');
    expect(job.stages.voice.status).toBe('pending');
    expect(h.speak).not.toHaveBeenCalled();
    expect((await readFactcheck(slug))!.issues).toHaveLength(1);

    await overrideFacts(slug);
    const after = await runJob(slug, h.deps);
    expect(after.stages.factcheck.status).toBe('done');
    expect(after.stages.render.status).toBe('done');
  });

  it('gives the design one more round with the gate errors, then passes', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness({ badDesign: 1 });
    const job = await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'design')).toHaveLength(2);
    expect(job.stages.gates.status).toBe('done');
    const second = h.run.mock.calls.filter(([, o]) => (o as { allowedTools?: string[] }).allowedTools?.includes('Write'))[1][0];
    expect(second).toContain('timing.json says');
  });

  it('fails the gates stage when the second round still fails, and does not render', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness({ badDesign: 5 });
    const job = await runJob(slug, h.deps);
    expect(job.stages.gates.status).toBe('failed');
    expect(job.stages.gates.error).toContain('timing.json says');
    expect(job.stages.render.status).toBe('pending');
    expect(h.calls).not.toContain('render');
  });

  it('refuses to run the same explainer twice at once', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness();
    const first = runJob(slug, h.deps);
    await expect(runJob(slug, h.deps)).rejects.toThrow(/already running/);
    await first;
  });

  it('runs a single stage with `only`, without invalidating the rest', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness();
    await runJob(slug, h.deps);
    const before = h.calls.length;
    const job = await runJob(slug, h.deps, { only: 'render' });
    expect(h.calls.slice(before)).toContain('render');
    expect(h.calls.slice(before)).not.toContain('design');
    expect(job.stages.design.status).toBe('done');
  });
});

describe('reviseJob', () => {
  it('wording notes rerun from the script; visual notes rerun from the design', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness();
    await runJob(slug, h.deps);
    let j = await reviseJob(slug, 'Say it shorter', 'wording');
    expect(j.notes).toBe('Say it shorter');
    expect(j.stages.script.status).toBe('pending');
    expect(j.stages.render.status).toBe('pending');
    await runJob(slug, h.deps);
    j = await reviseJob(slug, 'Bigger cards', 'visual');
    expect(j.stages.script.status).toBe('done');
    expect(j.stages.voice.status).toBe('done');
    expect(j.stages.design.status).toBe('pending');
    const before = h.calls.filter((c) => c === 'script').length;
    await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'script').length).toBe(before);
    const designPrompt = h.run.mock.calls.filter(([, o]) => (o as { allowedTools?: string[] }).allowedTools?.includes('Write')).at(-1)![0];
    expect(designPrompt).toContain('Bigger cards');
  });
});

describe('word budget rewrite', () => {
  it('rewrites the script once, cut to a word count, when the finished voice runs over 115% of the brief', async () => {
    const slug = await createExplainer(BRIEF); // 30 s: over 34.5 s is too long
    const h = harness({ scripts: [script('Long draft'), script('Short draft')], probeSeconds: [12, 12, 12, 12] }); // 4 x 12.35 s
    const job = await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'script')).toHaveLength(2);
    expect(h.speak).toHaveBeenCalledTimes(8); // every beat spoken again after the cut
    expect((await readScript(slug))!.title).toBe('Short draft');
    const cutPrompt = h.run.mock.calls.filter(([, o]) => !(o as { allowedTools?: string[] }).allowedTools)[1][0];
    expect(cutPrompt).toMatch(/Cut to \d+ words/);
    expect(cutPrompt).toContain('Long draft');
    expect(job.stages.render.status).toBe('done');
  });
  it('does not rewrite twice when the second voice is still long', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness({ scripts: [script('Long draft'), script('Still long')], probeSeconds: Array(8).fill(12) });
    await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'script')).toHaveLength(2);
    expect(h.speak).toHaveBeenCalledTimes(8);
  });
  it('leaves a video alone when it is within 115% of the brief', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness({ probeSeconds: [8, 8, 8, 8] }); // 4 x 8.35 = 33.4 s, under 34.5
    await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'script')).toHaveLength(1);
    expect(h.speak).toHaveBeenCalledTimes(4);
  });
  it('keeps the first script and voice when the rewrite does not validate', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness({ scripts: [script('Long draft'), { nonsense: true }], probeSeconds: [12, 12, 12, 12] });
    const job = await runJob(slug, h.deps);
    expect((await readScript(slug))!.title).toBe('Long draft');
    expect(job.stages.voice.status).toBe('done');
    expect(h.speak).toHaveBeenCalledTimes(4);
  });
  it('fact-checks the shortened script, and keeps the checked original when the shorter one fails', async () => {
    const slug = await createExplainer(BRIEF);
    const bad = { ok: false, issues: [{ beat: 'b2', claim: 'x', correction: 'y' }] };
    const h = harness({ scripts: [script('Long draft'), script('Short but wrong')], facts: [{ ok: true, issues: [] }, bad, bad], probeSeconds: [12, 12, 12, 12] });
    const job = await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'factcheck')).toHaveLength(2);
    expect((await readScript(slug))!.title).toBe('Long draft');
    expect(h.speak).toHaveBeenCalledTimes(4);
    expect(job.stages.voice.status).toBe('done');
  });
  it('uses the shortened script when it passes its own fact check', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness({ scripts: [script('Long draft'), script('Short draft')], facts: [{ ok: true, issues: [] }], probeSeconds: [12, 12, 12, 12] });
    await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'factcheck')).toHaveLength(2);
    expect((await readScript(slug))!.title).toBe('Short draft');
  });
  it('speaks at the explainer pace', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness();
    await runJob(slug, h.deps);
    expect((h.speak.mock.calls[0] as unknown[])[2]).toEqual({ speed: 1.08 });
  });
});

describe('critic stage', () => {
  it('renders the motion strips, asks the critic once when it passes, and stores critic.json', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness();
    const job = await runJob(slug, h.deps);
    expect(job.stages.critic.status).toBe('done');
    expect(h.calls.filter((c) => c === 'critic')).toHaveLength(1);
    expect(h.calls.filter((c) => c === 'strips')).toHaveLength(1);
    expect(h.calls.indexOf('critic')).toBeGreaterThan(h.calls.indexOf('strips'));
    expect(h.calls.indexOf('render')).toBeGreaterThan(h.calls.indexOf('critic'));
    expect(h.tile).toHaveBeenCalledTimes(4); // one strip per beat
    const record = await readCritic(slug);
    expect(record?.pass).toBe(true);
    expect(record?.scores.hook).toBe(9);
    expect((await listExplainers())[0].criticMin).toBe(9);
  });
  it('runs one design round with the fixes and the strips when a score is under 8, then critiques again', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness({ critics: [BAD_CRITIC, GOOD_CRITIC] });
    const job = await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'critic')).toHaveLength(2);
    expect(h.calls.filter((c) => c === 'design')).toHaveLength(2); // the design, then the fix
    expect(h.calls.filter((c) => c === 'strips')).toHaveLength(2);
    const fixPrompt = h.run.mock.calls.filter(([, o]) => (o as { allowedTools?: string[] }).allowedTools?.includes('Write')).at(-1)![0];
    expect(fixPrompt).toContain('Make the hook number bigger');
    expect(fixPrompt).toContain('Motion strips of the current version');
    expect(job.stages.critic.status).toBe('done');
    expect((await readCritic(slug))?.rounds).toHaveLength(2);
  });
  it('stops after two critic rounds and records the failure, and still renders', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness({ critics: [BAD_CRITIC] });
    const job = await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'critic')).toHaveLength(2);
    expect((await readCritic(slug))?.pass).toBe(false);
    expect(job.stages.critic.status).toBe('done');
    expect(job.stages.render.status).toBe('done');
  });
  it('fails the stage when the critic cannot be read', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness({ critics: [{ nonsense: true }] });
    const job = await runJob(slug, h.deps);
    expect(job.stages.critic.status).toBe('failed');
    expect(job.stages.critic.error).toMatch(/critic/i);
    expect(job.stages.render.status).toBe('pending');
  });
  it('visual notes redo the critic too', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness();
    await runJob(slug, h.deps);
    const j = await reviseJob(slug, 'Bigger cards', 'visual');
    expect(j.stages.critic.status).toBe('pending');
  });
});

describe('changeBed', () => {
  it('writes sound.json and makes only the render pending', async () => {
    const slug = await createExplainer(BRIEF);
    const h = harness();
    await runJob(slug, h.deps);
    const j = await changeBed(slug, 'music/calm-2.mp3');
    expect(await readSound(slug)).toEqual({ bed: 'music/calm-2.mp3' });
    expect(j.stages.render.status).toBe('pending');
    expect(j.stages.critic.status).toBe('done');
    expect(j.stages.design.status).toBe('done');
    const before = h.calls.filter((c) => c === 'design').length;
    await runJob(slug, h.deps);
    expect(h.calls.filter((c) => c === 'design').length).toBe(before);
    expect((await readJob(slug))!.stages.render.status).toBe('done');
  });
});

