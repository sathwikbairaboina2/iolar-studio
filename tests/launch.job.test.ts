import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { approveLaunch, isLaunchRunning, overrideLaunchFacts, reviseLaunch, runLaunch, type LaunchDeps } from '@/lib/launch/job';
import { HfUnreachable } from '@/lib/launch/higgsfield';
import { createLaunch, readAssets, readCritic, readFactcheck, readJob, readProps } from '@/lib/launch/store';
import { launchRoot } from '@/lib/paths';

const CLAIMS = { claims: [
  { id: 'c1', text: 'GPT-6 costs $10 per 1M input tokens', value: 10, unit: '$', url: 'https://openai.com/pricing', quote: '$10.00 / 1M tokens' },
  { id: 'c2', text: 'Gemini 4 costs $3 per 1M input tokens', value: 3, unit: '$', url: 'https://ai.google.dev/pricing', quote: '$3.00 / 1M tokens' },
  { id: 'c3', text: 'Gemini 4 has a 1M token context window', value: 1000000, unit: 'tokens', url: 'https://blog.google/x', quote: '1 million token context window' },
] };
const SCRIPT = {
  headline: 'Gemini 4 is here.', kicker: 'BREAKING',
  beats: [
    { id: 'hook', narration: 'Google just made GPT-6 look expensive.', emphasis: ['expensive'], claims: [] },
    { id: 'numbers', narration: 'Gemini 4 costs three dollars per million tokens, against ten.', emphasis: [], claims: ['c1', 'c2'] },
    { id: 'catch', narration: 'The catch is a rate limit on the free tier.', emphasis: [], claims: ['c3'] },
    { id: 'cta', narration: 'Follow for every launch, explained in a minute.', emphasis: [], claims: [] },
  ],
};
const EDIT = { scenes: [
  { type: 'Headline', beat: 'hook', weight: 1, kicker: 'BREAKING', title: 'Gemini 4 is here.' },
  { type: 'DeltaCard', beat: 'numbers', weight: 2, label: 'Price per 1M input tokens', before: 'c1', after: 'c2', better: 'lower', word: 'cheaper' },
  { type: 'Receipt', beat: 'numbers', weight: 1, claim: 'c3' },
  { type: 'Receipt', beat: 'catch', weight: 1, claim: 'c3' },
  { type: 'EndCard', beat: 'cta', weight: 1, line: 'Follow for every launch' },
] };
const EDIT_NO_RECEIPT = { scenes: [
  { type: 'Headline', beat: 'hook', weight: 1, kicker: 'BREAKING', title: 'Gemini 4 is here.' },
  { type: 'DeltaCard', beat: 'numbers', weight: 2, label: 'Price per 1M input tokens', before: 'c1', after: 'c2', better: 'lower', word: 'cheaper' },
  { type: 'BenchmarkBars', beat: 'numbers', weight: 1, title: 'Price', items: [{ label: 'GPT-6', claim: 'c1', ours: false }, { label: 'Gemini 4', claim: 'c2', ours: true }] },
  { type: 'Headline', beat: 'catch', weight: 1, kicker: 'THE CATCH', title: 'A rate limit applies.' },
  { type: 'EndCard', beat: 'cta', weight: 1, line: 'Follow for every launch' },
] };

let root: string;
let prompts: { research: string[]; script: string[]; fact: string[]; edit: string[] };
let focus: { x: number; y: number; w: number; h: number }[] | null;
let runCount: number;

function makeDeps(over: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    run: async (prompt) => {
      runCount++;
      if (prompt.includes('You research')) { prompts.research.push(prompt); return JSON.stringify(CLAIMS); }
      if (prompt.includes('You write the voiceover')) { prompts.script.push(prompt); return JSON.stringify(SCRIPT); }
      if (prompt.includes('You fact-check')) { prompts.fact.push(prompt); return JSON.stringify({ ok: true, issues: [] }); }
      if (prompt.includes('You cut a short vertical')) {
        prompts.edit.push(prompt);
        return JSON.stringify(focus === null && prompt.includes('refused for these reasons') ? EDIT_NO_RECEIPT : EDIT);
      }
      throw new Error(`unexpected prompt: ${prompt.slice(0, 60)}`);
    },
    speak: async (_t, p) => { await fs.writeFile(p, ''); },
    probe: async () => 5,
    browser: async () => ({
      capture: async (_u, _q, png) => {
        await fs.writeFile(png, 'png');
        return { width: 1080, height: 1350, focus };
      },
      close: async () => undefined,
    }),
    proc: async (cmd, args, o) => {
      if (cmd === 'ffmpeg') {
        await fs.writeFile(args[args.length - 1], 'x');
        return { code: 0, output: '' };
      }
      const out = path.resolve(o.cwd!, args[4]);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, 'x');
      return { code: 0, output: '' };
    },
    root,
    ...over,
  };
}

const brief = { title: 'Gemini 4', links: ['https://blog.google/x'], look: 'newsroom' as const };

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-job-'));
  root = mkdtempSync(path.join(os.tmpdir(), 'launch-job-root-'));
  prompts = { research: [], script: [], fact: [], edit: [] };
  focus = [{ x: 1, y: 2, w: 3, h: 4 }];
  runCount = 0;
});

describe('launch job', () => {
  it('stops at approve, then runs to a render once approved', async () => {
    const slug = await createLaunch(brief);
    const deps = makeDeps();
    let job = await runLaunch(slug, deps);
    expect(job.stages.approve.status).toBe('blocked');
    expect(job.stages.voice.status).toBe('pending');
    await approveLaunch(slug);
    job = await runLaunch(slug, deps);
    expect(job.stages.render.status).toBe('done');
    expect(job.renderId).toMatch(/^[0-9a-f]{12}$/);
    expect((await readProps(slug))?.scenes.map((s) => s.type)).toEqual(['Headline', 'DeltaCard', 'Receipt', 'Receipt', 'EndCard']);
    expect((await readProps(slug))?.date).toMatch(/^\d\d\.\d\d\.\d\d$/);
  });

  it('clears approval when the script is revised', async () => {
    const slug = await createLaunch(brief);
    const deps = makeDeps();
    await runLaunch(slug, deps);
    await approveLaunch(slug);
    await reviseLaunch(slug, 'Say the price first.', 'wording');
    expect((await readJob(slug))?.approved).toBe(false);
    const job = await runLaunch(slug, deps);
    expect(job.approved).toBe(false);
    expect(job.stages.approve.status).toBe('blocked');
    expect(prompts.script.at(-1)).toContain('Say the price first.');
  });

  it('clears approval when the script stage runs again with no notes', async () => {
    const slug = await createLaunch(brief);
    const deps = makeDeps();
    await runLaunch(slug, deps);
    await approveLaunch(slug);
    const job = await runLaunch(slug, deps, { from: 'script' });
    expect(job.approved).toBe(false);
    expect(job.stages.approve.status).toBe('blocked');
    expect(job.stages.voice.status).toBe('pending');
  });

  it('sends a receipt whose quote is missing back to the edit list, then renders without it', async () => {
    focus = null;
    const slug = await createLaunch(brief);
    const deps = makeDeps();
    await runLaunch(slug, deps);
    await approveLaunch(slug);
    const job = await runLaunch(slug, deps);
    expect(job.stages.gates.status).toBe('done');
    expect(job.stages.render.status).toBe('done');
    expect((await readProps(slug))?.scenes.some((s) => s.type === 'Receipt')).toBe(false);
    expect(prompts.edit[1]).toMatch(/c3.*not found/);
  });

  it('records a failed stage and stops', async () => {
    const slug = await createLaunch(brief);
    const job = await runLaunch(slug, makeDeps({ run: async () => 'not json' }));
    expect(job.stages.research.status).toBe('failed');
    expect(job.stages.research.error).toMatch(/did not validate/);
    expect(job.stages.script.status).toBe('pending');
  });

  it('rewrites once after a fact-check issue, then blocks when it persists', async () => {
    const slug = await createLaunch(brief);
    const run: LaunchDeps['run'] = async (prompt) => {
      if (prompt.includes('You fact-check')) return JSON.stringify({ ok: false, issues: [{ beat: 'numbers', claim: 'ten', correction: 'It is $10.50.' }] });
      return makeDeps().run(prompt);
    };
    const job = await runLaunch(slug, makeDeps({ run }));
    expect(job.stages.factcheck.status).toBe('blocked');
    expect(job.stages.approve.status).toBe('pending');
    expect(prompts.script).toHaveLength(2);
    expect((await readFactcheck(slug))?.ok).toBe(false);
    await overrideLaunchFacts(slug);
    expect((await readJob(slug))?.stages.factcheck.status).toBe('done');
  });

  it('is not running once it has returned', async () => {
    const slug = await createLaunch(brief);
    await runLaunch(slug, makeDeps());
    expect(isLaunchRunning(slug)).toBe(false);
    expect(runCount).toBeGreaterThan(0);
  });
});

describe('launch job, avatar mode', () => {
  const AV_EDIT = { scenes: [
    { type: 'Headline', beat: 'hook', weight: 1, kicker: 'BREAKING', title: 'Gemini 4 is here.' },
    { type: 'DeltaCard', beat: 'numbers', weight: 2, label: 'Price per 1M input tokens', before: 'c1', after: 'c2', better: 'lower', word: 'cheaper' },
    { type: 'AvatarTalk', beat: 'catch', weight: 1, layout: 'columnist', over: 'c3', quote: 'a rate limit' },
    { type: 'EndCard', beat: 'cta', weight: 1, line: 'Follow for every launch' },
  ] };

  async function avatarReel() {
    await fs.mkdir(path.join(launchRoot(), 'anchor'), { recursive: true });
    await fs.writeFile(path.join(launchRoot(), 'anchor.json'), JSON.stringify({ imageJobId: 'img-job-1', file: 'anchor/portrait.png', prompt: 'p', lockedAt: 'x' }));
    await fs.writeFile(path.join(launchRoot(), 'anchor/portrait.png'), 'face');
    return createLaunch({ ...brief, mode: 'avatar' });
  }
  const avDeps = (over: Partial<LaunchDeps> = {}) => makeDeps({
    run: async (prompt) => (prompt.includes('You cut a short vertical') ? JSON.stringify(AV_EDIT) : makeDeps().run(prompt)),
    ...over,
  });

  it('renders the reel with the portrait still when Higgsfield is not reachable, and says so', async () => {
    const slug = await avatarReel();
    const deps = avDeps({ hf: async () => { throw new HfUnreachable(); } });
    await runLaunch(slug, deps);
    await approveLaunch(slug);
    const job = await runLaunch(slug, deps);
    expect(job.stages.render.status).toBe('done');
    const talk = (await readProps(slug))!.scenes.find((s) => s.type === 'AvatarTalk');
    expect(talk).toMatchObject({ type: 'AvatarTalk', video: null, portrait: `launch/${slug}/anchor.png`, receipt: { source: 'blog.google' } });
    const assets = (await readAssets(slug))!;
    expect(Object.values(assets.assets).map((a) => a.source)).toEqual(['still']);
    expect(assets.notes).toEqual(['Higgsfield is not reachable from the studio']);
  });

  it('offers the anchor scene to the edit prompt only in an avatar reel', async () => {
    const slug = await avatarReel();
    await runLaunch(slug, avDeps());
    expect(prompts.edit.length).toBe(0);
    await approveLaunch(slug);
    await runLaunch(slug, makeDeps({ run: async (p) => { if (p.includes('You cut a short vertical')) prompts.edit.push(p); return avDeps().run(p); } }));
    expect(prompts.edit[0]).toMatch(/AvatarTalk \{/);
  });

  it('stops at the gates when an AvatarTalk scene is cut into a faceless reel', async () => {
    const slug = await createLaunch(brief);
    const deps = makeDeps({ run: async (p) => (p.includes('You cut a short vertical') ? JSON.stringify(AV_EDIT) : makeDeps().run(p)) });
    await runLaunch(slug, deps);
    await approveLaunch(slug);
    const job = await runLaunch(slug, deps);
    expect(job.stages.edit.status).toBe('failed');
    expect(job.stages.edit.error).toMatch(/avatar mode/);
  });
});

describe('launch job, critic', () => {
  const GOOD = { scores: { hook: 9, readable: 9, receipts: 9, numbers: 9, pacing: 9, clean: 9, look: 9 }, fixes: [] };
  const BAD = { scores: { hook: 5, readable: 9, receipts: 9, numbers: 9, pacing: 9, clean: 9, look: 9 }, fixes: ['Say what changed in the headline'] };
  // The revised list: a different headline (so a different render), and a receipt of c1 that has not been captured yet.
  const FIXED = { scenes: EDIT.scenes.map((s) => (s.type === 'Headline' ? { ...s, title: 'Gemini 4 is here, cheaper.' } : s)) };
  const FIXED_NEW_RECEIPT = { scenes: EDIT.scenes.map((s, i) => (i === 2 ? { ...s, claim: 'c1' } : s)) };

  let critiques: string[];
  let taken: string[];

  function criticDeps(answers: unknown[], revised: unknown): LaunchDeps {
    const base = makeDeps();
    return makeDeps({
      run: async (prompt, o) => {
        if (prompt.includes('You review a news reel')) {
          critiques.push(prompt);
          return JSON.stringify(answers[Math.min(critiques.length - 1, answers.length - 1)]);
        }
        if (prompt.includes('to be revised')) return JSON.stringify(revised);
        return base.run(prompt, o);
      },
      frame: async (mp4, _f, _p, out) => { taken.push(mp4); await fs.writeFile(out, 'f'); },
      tile: async (_files, out) => { await fs.writeFile(out, 'strip'); },
    });
  }

  async function polished(deps: LaunchDeps) {
    const slug = await createLaunch({ ...brief, speed: 'polish' });
    await runLaunch(slug, deps);
    await approveLaunch(slug);
    return { slug, job: await runLaunch(slug, deps) };
  }

  beforeEach(() => {
    critiques = [];
    taken = [];
  });

  it('never runs in a fast reel, which is done at once', async () => {
    const slug = await createLaunch(brief);
    const deps = criticDeps([GOOD], EDIT);
    await runLaunch(slug, deps);
    await approveLaunch(slug);
    const job = await runLaunch(slug, deps);
    expect(job.stages.render.status).toBe('done');
    expect(job.stages.critic.status).toBe('done');
    expect(critiques).toEqual([]);
    expect(taken).toEqual([]);
    expect(await readCritic(slug)).toBeNull();
  });

  it('revises the edit list after a failing round, renders again and passes', async () => {
    const { slug, job } = await polished(criticDeps([BAD, GOOD], FIXED));
    const firstId = path.basename(taken[0], '.mp4');
    expect(job.stages.critic.status).toBe('done');
    expect(critiques).toHaveLength(2);
    expect(job.renderId).toMatch(/^[0-9a-f]{12}$/);
    expect(job.renderId).not.toBe(firstId);
    const rec = (await readCritic(slug))!;
    expect(rec.pass).toBe(true);
    expect(rec.rounds).toHaveLength(2);
    expect((await readProps(slug))?.scenes[0]).toMatchObject({ type: 'Headline' });
    expect((await fs.readdir(path.join(launchRoot(), slug, 'renders'))).filter((f) => f.endsWith('.mp4'))).toHaveLength(2);
    // The first critique looked at the first render, the second at the newest one.
    expect(taken.slice(0, 6).every((m) => m.endsWith(`${firstId}.mp4`))).toBe(true);
    expect(taken.slice(-6).every((m) => m.endsWith(`${job.renderId}.mp4`))).toBe(true);
    expect(critiques[0]).toContain('00-Headline.png');
  });

  it('keeps the earlier render, records the critic, and finishes when the revised list cannot pass the gates', async () => {
    const deps = criticDeps([BAD, GOOD], FIXED_NEW_RECEIPT);
    const run = deps.run;
    // Once the critic has spoken, the quote for the receipt it asks for is no longer on its page.
    deps.run = async (p, o) => {
      if (p.includes('You review a news reel')) focus = null;
      return run(p, o);
    };
    const { slug, job } = await polished(deps);
    const firstId = path.basename(taken[0], '.mp4');
    expect(job.stages.render.status).toBe('done');
    expect(job.stages.critic.status).toBe('done');
    expect(job.renderId).toBe(firstId);
    const record = (await readCritic(slug))!;
    expect(record.pass).toBe(false);
    expect(record.rounds).toHaveLength(1);
    expect(record.fixError).toMatch(/c1.*not found/);
    expect((await fs.readdir(path.join(launchRoot(), slug, 'renders'))).filter((f) => f.endsWith('.mp4'))).toHaveLength(1);
  });
});

describe('launch voice stage', () => {
  const hfWith = (over: Partial<import('@/lib/launch/higgsfield').Hf> = {}) => ({
    balance: async () => 100, cost: async () => 0.11, uploadFile: async () => 'm', generateVideo: async () => 'v', generateImage: async () => 'i',
    generateAudio: async () => 'a-1', wait: async () => ({ 'a-1': { status: 'completed' as const, url: 'https://cdn/a.mp3' } }), ...over,
  });
  const http = (async () => new Response(new Uint8Array([9]), { status: 200 })) as unknown as typeof fetch;

  it('speaks through Higgsfield qwen when it is reachable', async () => {
    const slug = await createLaunch({ ...brief, creditBudget: 5 });
    const kokoro: string[] = [];
    const deps = makeDeps({ hf: async () => hfWith(), http, speak: async (t) => { kokoro.push(t); } });
    await runLaunch(slug, deps, { only: 'research' });
    await runLaunch(slug, deps, { only: 'script' });
    await approveLaunch(slug);
    await runLaunch(slug, deps, { only: 'voice' });
    expect(kokoro).toEqual([]);
    expect((await fs.readFile(path.join(launchRoot(), slug, 'voice', 'hook.mp3'))).length).toBe(1);
    expect(JSON.parse(await fs.readFile(path.join(launchRoot(), slug, 'voice.json'), 'utf8')).provider).toBe('qwen');
  });

  it('falls back to Kokoro with the launch voice and records a note when Higgsfield is unreachable', async () => {
    const slug = await createLaunch(brief);
    const used: (string | undefined)[] = [];
    const deps = makeDeps({ hf: async () => { throw new HfUnreachable(); }, speak: async (_t, p, o) => { used.push(o?.voice); await fs.writeFile(p, ''); } });
    await runLaunch(slug, deps, { only: 'research' });
    await runLaunch(slug, deps, { only: 'script' });
    await approveLaunch(slug);
    await runLaunch(slug, deps, { only: 'voice' });
    expect(used.length).toBe(4);
    expect(used.every((v) => v === 'hm_psi')).toBe(true);
    const rec = JSON.parse(await fs.readFile(path.join(launchRoot(), slug, 'voice.json'), 'utf8'));
    expect(rec.provider).toBe('kokoro');
    expect(rec.notes[0]).toMatch(/Kokoro/);
  });
});

describe('the speech-start gate', () => {
  const late = async (t: string, ...rest: unknown[]) => [{ w: 'Google', start: 0.5, end: 0.8 }, { w: 'just', start: 0.8, end: 1 }];
  const run = async (look: 'creator' | 'newsroom') => {
    const slug = await createLaunch({ ...brief, look });
    const deps = makeDeps({ align: late });
    await runLaunch(slug, deps, { only: 'research' });
    await runLaunch(slug, deps, { only: 'script' });
    await approveLaunch(slug);
    return runLaunch(slug, deps, { only: 'voice' });
  };
  it('fails the voice stage of a creator reel whose first word starts after frame 3', async () => {
    const job = await run('creator');
    expect(job.stages.voice.status).toBe('failed');
    expect(job.stages.voice.error).toMatch(/speech starts at frame 15/);
  });
  it('leaves a newsroom reel alone', async () => {
    expect((await run('newsroom')).stages.voice.status).toBe('done');
  });
});
