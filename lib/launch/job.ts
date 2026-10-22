import { runProc, type Proc } from '@/lib/explainer2/commands';
import { issuesToNotes } from '@/lib/explainer2/factcheck';
import type { ClaudeRun } from '@/lib/explainer2/script';
import { chooseBed, readManifest } from '@/lib/explainer2/sound';
import { tileFrames } from '@/lib/explainer2/strips';
import { speakBeats } from '@/lib/explainer2/voice';
import { renderRoot } from '@/lib/explainer2/workspace';
import type { HeardWord } from '@/lib/explainer2/words';
import type { VideoProvider } from '@/lib/reel/videoProvider';
import path from 'path';
import { promises as fs } from 'fs';
import { getSettings } from '@/lib/settings';
import { launchFile, launchRendersDir, launchVoiceDir } from '@/lib/paths';
import { makeAssets } from './assets';
import { critiqueLaunch, launchCriticLoop, launchCriticNotes, launchStrips, realFrame, type StripDeps } from './critic';
import { generateEdit, receiptClaims, resolveEdit, type ResolveCtx } from './edit';
import type { Hf } from './higgsfield';
import { checkLaunchScript } from './factcheck';
import { captureReceipts, playwrightCapture, type Capture } from './receipts';
import { renderLaunch } from './render';
import { generateClaims } from './research';
import { STAGES, type Job, type Stage } from './schema';
import { generateLaunchScript } from './script';
import { hfSpeak, speechStartError, withKokoroFallback } from './voice';
import {
  readAssets, readBrief, readClaims, readEditInput, readFactcheck, readJob, readProps, readReceipts, readScript, readSound, readTiming,
  writeClaims, writeCritic, writeEditInput, writeFactcheck, writeJob, writeProps, writeScript, writeSound,
} from './store';

/**
 * One job per launch reel, resumable per stage: its state lives in job.json, a stage that is `done` is not run again,
 * and re-running an earlier stage marks every later one pending, because their inputs changed.
 *
 *   research -> script -> factcheck -> approve -> voice -> edit -> assets -> gates -> render -> critic
 *
 * `critic` runs only for a `polish` reel; a `fast` reel is done at the render.
 * The job stops at `approve` until a person approves the script, and approval is cleared whenever the script is written again.
 */

export type LaunchDeps = {
  run: ClaudeRun;
  speak: (text: string, mp3Path: string, opts?: { speed?: number; voice?: string }) => Promise<unknown>;
  probe: (file: string) => Promise<number>;
  /** Word timings for a voice clip (whisper). Without it, or when it fails, the captions use an even spread. */
  align?: (mp3: string, text: string) => Promise<HeardWord[]>;
  /** Kokoro speed for the voice; defaults to a news pace (1.12). */
  speed?: number;
  /** One browser for the receipt screenshots of a stage. */
  browser: () => Promise<{ capture: Capture; close: () => Promise<void> }>;
  proc: Proc;
  /** Higgsfield, made only when a reel needs it (avatar clips, b-roll). Absent counts as not reachable. */
  hf?: () => Promise<Hf>;
  /** The free lip-sync desk, the fallback for avatar clips. */
  lipsync?: VideoProvider | null;
  /** For downloads (demo clips, generated photos, X posts). */
  http?: typeof fetch;
  /** One frame out of an mp4 (ffmpeg), and a row of frames tiled into one png. For the critic; absent means the real ones. */
  frame?: StripDeps['frame'];
  tile?: StripDeps['tile'];
  /** The Remotion project; defaults to the plugin's render/. */
  root?: string;
  now?: () => Date;
};

/** The real model, voice, ffprobe, browser and processes. Loaded lazily so tests and the page never import them. */
export async function realLaunchDeps(): Promise<LaunchDeps> {
  const [{ runClaude }, { speak }, { ffprobeMedia }, { alignVoice }, { realHf }, { createLipsyncProvider }] = await Promise.all([
    import('@/lib/ai/claude'),
    import('@/lib/reel/tts'),
    import('@/lib/reel/probe'),
    import('@/lib/reel/align'),
    import('./higgsfield'),
    import('@/lib/reel/providers/lipsync'),
  ]);
  return {
    run: runClaude,
    speak: (t, p, o) => speak(t, p, o),
    probe: async (f) => (await ffprobeMedia(f)).durationSec,
    align: async (mp3, text) => (await alignVoice(mp3, text)).map((w) => ({ w: w.w, start: w.start, end: w.end })),
    browser: playwrightCapture,
    proc: runProc,
    hf: realHf,
    lipsync: createLipsyncProvider(),
    http: fetch,
    root: renderRoot(),
    frame: realFrame,
    tile: (files, out) => tileFrames(files, out),
  };
}

export class LaunchJobError extends Error {}

const WORK = STAGES.filter((s): s is Exclude<Stage, 'brief'> => s !== 'brief');
const running = new Set<string>();
const NEWS_SPEED = 1.12;
const BED_MOODS = ['driving', 'tense', 'focused', 'steady', 'curious'];

export function nextLaunchStage(job: Job): Stage | null {
  return WORK.find((s) => job.stages[s].status !== 'done') ?? null;
}

const stamp = (deps: LaunchDeps) => (deps.now ?? (() => new Date()))().toISOString();

async function load(slug: string): Promise<Job> {
  const job = await readJob(slug);
  if (!job) throw new LaunchJobError(`no launch reel called ${slug}`);
  return job;
}

async function save(job: Job, deps: LaunchDeps): Promise<void> {
  job.updatedAt = stamp(deps);
  await writeJob(job);
}

function mark(job: Job, stage: Stage, status: Job['stages'][Stage]['status'], deps: LaunchDeps, error?: string) {
  job.stages[stage] = { status, at: stamp(deps), ...(error ? { error } : {}) };
}

function invalidateFrom(job: Job, from: Stage) {
  for (const s of WORK.slice(WORK.indexOf(from as (typeof WORK)[number]))) job.stages[s] = { status: 'pending' };
}

/** "2026-10-21T08:00:00.000Z" as the masthead date "21.10.26". */
export function ddmmyy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

/** Runs one stage; returns false when the job must stop here without failing (it is waiting for a person). */
async function exec(stage: Exclude<Stage, 'brief'>, job: Job, deps: LaunchDeps): Promise<boolean> {
  const slug = job.slug;
  const brief = (await readBrief(slug))!;
  const root = deps.root ?? renderRoot();

  if (stage === 'research') {
    await writeClaims(slug, await generateClaims(brief, deps));
    return true;
  }

  if (stage === 'script') {
    const claims = (await readClaims(slug))!;
    const previous = job.notes ? ((await readScript(slug)) ?? undefined) : undefined;
    await writeScript(slug, await generateLaunchScript(brief, claims, deps, { notes: job.notes || undefined, previous }));
    job.approved = false;
    return true;
  }

  if (stage === 'factcheck') {
    const claims = (await readClaims(slug))!;
    let script = (await readScript(slug))!;
    let result = await checkLaunchScript(script, claims, deps);
    if (!result.ok && !job.factOverride) {
      // One rewrite with the corrections as notes, then one more check. Issues that survive go to a person.
      script = await generateLaunchScript(brief, claims, deps, { notes: issuesToNotes(result.issues), previous: script });
      await writeScript(slug, script);
      job.approved = false;
      result = await checkLaunchScript(script, claims, deps);
    }
    await writeFactcheck(slug, result);
    if (!result.ok && !job.factOverride) {
      mark(job, 'factcheck', 'blocked', deps, `${result.issues.length} issue${result.issues.length === 1 ? '' : 's'} left; edit the script or override`);
      return false;
    }
    return true;
  }

  if (stage === 'approve') {
    if (job.approved) return true;
    mark(job, 'approve', 'blocked', deps, 'waiting for approval');
    return false;
  }

  if (stage === 'voice') {
    const script = (await readScript(slug))!;
    const { launchVoice, launchKokoroVoice } = getSettings();
    const speed = deps.speed ?? NEWS_SPEED;
    const notes: string[] = [];
    const kokoro = { voice: launchKokoroVoice, speed };
    // qwen through Higgsfield when it is asked for and reachable; otherwise, or when a line fails, Kokoro at the news pace.
    const speak = launchVoice === 'qwen' && deps.hf
      ? withKokoroFallback(
          async (text, mp3) => hfSpeak(await deps.hf!(), slug, deps.http ?? fetch)(text, mp3),
          deps.speak, kokoro, (n) => notes.push(n),
        )
      : (text: string, mp3: string) => deps.speak(text, mp3, kokoro);
    const timing = await speakBeats(slug, script, { speak, probe: deps.probe, align: deps.align, speed }, {
      voiceDir: launchVoiceDir(slug),
      timingFile: launchFile(slug, 'timing.json'),
    });
    // The gate for the creator look: speech starts at frame 0.
    const late = brief.look === 'creator' ? speechStartError(timing) : null;
    if (late) throw new LaunchJobError(late);
    await fs.writeFile(launchFile(slug, 'voice.json'), JSON.stringify({ provider: launchVoice === 'qwen' && deps.hf && !notes.length ? 'qwen' : 'kokoro', notes }, null, 2));
    return true;
  }

  const ctx = async (receipts: ResolveCtx['receipts'], assets: ResolveCtx['assets'] = null): Promise<ResolveCtx> => ({
    slug,
    date: ddmmyy(brief.createdAt),
    bed: (await readSound(slug))?.bed ?? null,
    timing: (await readTiming(slug))!,
    script: (await readScript(slug))!,
    claims: (await readClaims(slug))!,
    receipts,
    mode: brief.mode,
    look: brief.look ?? 'newsroom',
    demos: brief.demos.map((d) => d.id),
    posts: brief.posts.map((p) => p.id),
    assets,
  });

  if (stage === 'edit') {
    const base = await ctx(null);
    const input = await generateEdit({ brief, script: base.script, claims: base.claims, timing: base.timing, notes: job.notes || undefined }, deps, (i) => resolveEdit(i, base).errors);
    await writeEditInput(slug, input);
    return true;
  }

  /** Receipt screenshots, then the avatar clips, photos, demo clips and post cards the edit list asks for. */
  const makeAll = async (input: NonNullable<Awaited<ReturnType<typeof readEditInput>>>) => {
    const claims = (await readClaims(slug))!;
    const browser = await deps.browser();
    try {
      await captureReceipts(slug, claims, receiptClaims(input), browser.capture);
    } finally {
      await browser.close();
    }
    const timing = (await readTiming(slug))!;
    await makeAssets(slug, input, brief, timing, { hf: deps.hf, lipsync: deps.lipsync ?? null, http: deps.http ?? fetch, proc: deps.proc });
  };

  if (stage === 'assets') {
    await makeAll((await readEditInput(slug))!);
    await writeSound(slug, { bed: chooseBed(await readManifest(root), slug, BED_MOODS) });
    return true;
  }

  if (stage === 'gates') {
    let input = (await readEditInput(slug))!;
    const resolve = async () => resolveEdit(input, await ctx((await readReceipts(slug)) ?? {}, (await readAssets(slug)) ?? { assets: {}, notes: [] }));
    let resolved = await resolve();
    // A receipt whose quote is not on its page, or a number scene that does not add up, goes back to the edit list with the reasons.
    for (let round = 0; round < 2 && resolved.errors.length; round++) {
      const base = await ctx(null);
      input = await generateEdit({ brief, script: base.script, claims: base.claims, timing: base.timing, errors: resolved.errors, notes: job.notes || undefined }, deps, (i) => resolveEdit(i, base).errors);
      await writeEditInput(slug, input);
      await makeAll(input);
      resolved = await resolve();
    }
    if (!resolved.props) throw new LaunchJobError(resolved.errors.join('\n'));
    await writeProps(slug, resolved.props);
    return true;
  }

  if (stage === 'render') {
  if ((await readFactcheck(slug))?.ok === false && !job.factOverride) throw new LaunchJobError('the fact check still has issues; edit the script or override');
  const props = (await readProps(slug))!;
  job.renderId = await renderLaunch(slug, props, { proc: deps.proc, root });
  job.notes = '';
  return true;
  }

  // critic
  if (brief.speed !== 'polish') return true;
  const script = (await readScript(slug))!;
  const claims = (await readClaims(slug))!;
  const timing = (await readTiming(slug))!;
  let props = (await readProps(slug))!;
  let input = (await readEditInput(slug))!;
  const stripDeps: StripDeps = { frame: deps.frame ?? realFrame, tile: deps.tile ?? ((files, out) => tileFrames(files, out)) };

  const record = await launchCriticLoop({
    // The frames come from the newest render, named by the job.
    critique: async () => {
      if (!job.renderId) throw new LaunchJobError('there is no render to review');
      const strips = await launchStrips(slug, props, path.join(launchRendersDir(slug), `${job.renderId}.mp4`), stripDeps);
      return critiqueLaunch(deps, { script, props, strips });
    },
    // The critic's fixes go to the edit list. The earlier list, props and render stay until a new one has passed the gates.
    fix: async (fixes, low) => {
      const base = await ctx(null);
      const structural = (i: Parameters<typeof resolveEdit>[0]) => resolveEdit(i, base).errors;
      const full = async (i: typeof input) => resolveEdit(i, await ctx((await readReceipts(slug)) ?? {}, (await readAssets(slug)) ?? { assets: {}, notes: [] }));
      const notes = launchCriticNotes(fixes, low);
      let candidate = await generateEdit({ brief, script, claims, timing, notes, previous: input }, deps, structural);
      await makeAll(candidate);
      let resolved = await full(candidate);
      if (!resolved.props) {
        candidate = await generateEdit({ brief, script, claims, timing, notes, previous: candidate, errors: resolved.errors }, deps, structural);
        await makeAll(candidate);
        resolved = await full(candidate);
      }
      if (!resolved.props) throw new LaunchJobError(`the critic's fixes could not pass the checks; the earlier render was kept:\n${resolved.errors.join('\n')}`);
      input = candidate;
      props = resolved.props;
      await writeEditInput(slug, input);
      await writeProps(slug, props);
      job.renderId = await renderLaunch(slug, props, { proc: deps.proc, root });
    },
  });
  await writeCritic(slug, record);
  return true;
}

export type LaunchRunOpts = {
  /** Start here instead of at the first stage that is not done. Runs this stage and every later one. */
  from?: Stage;
  /** Run just this stage and leave the others as they are. */
  only?: Stage;
};

/**
 * Runs the pending stages in order and saves after each. A failed stage is recorded in job.json and stops the run;
 * the job is returned either way, so the caller reads the outcome off the stages.
 */
export async function runLaunch(slug: string, deps: LaunchDeps, opts: LaunchRunOpts = {}): Promise<Job> {
  if (running.has(slug)) throw new LaunchJobError(`${slug} is already running`);
  running.add(slug);
  try {
    const job = await load(slug);
    const only = opts.only && opts.only !== 'brief' ? opts.only : undefined;
    const first = only ?? (opts.from && opts.from !== 'brief' ? opts.from : nextLaunchStage(job));
    if (!first) return job;
    const from = WORK.indexOf(first as (typeof WORK)[number]);
    const to = only ? from : WORK.length - 1;
    if (!only) invalidateFrom(job, first);
    // Words written again are words nobody approved: voicing them waits for a new approval.
    if (first === 'research' || first === 'script') job.approved = false;

    for (let i = from; i <= to; i++) {
      const stage = WORK[i];
      mark(job, stage, 'running', deps);
      await save(job, deps);
      try {
        const proceed = await exec(stage, job, deps);
        if (!proceed) {
          await save(job, deps);
          return job;
        }
        mark(job, stage, 'done', deps);
        await save(job, deps);
      } catch (err) {
        mark(job, stage, 'failed', deps, err instanceof Error ? err.message : String(err));
        await save(job, deps);
        return job;
      }
    }
    return job;
  } finally {
    running.delete(slug);
  }
}

/** A person approves the script as it stands; the job may go on to voice. */
export async function approveLaunch(slug: string): Promise<Job> {
  const job = await load(slug);
  job.approved = true;
  if (job.stages.approve.status === 'blocked') job.stages.approve = { status: 'pending' };
  job.updatedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

/** Notes from the UI. Wording notes rewrite the script (and so clear approval and redo everything after it); visual notes redo the edit onward. */
export async function reviseLaunch(slug: string, notes: string, kind: 'wording' | 'visual'): Promise<Job> {
  const job = await load(slug);
  invalidateFrom(job, kind === 'wording' ? 'script' : 'edit');
  job.notes = notes.trim();
  if (kind === 'wording') {
    job.factOverride = false;
    job.approved = false;
  }
  job.updatedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

/** A person accepts the fact-check issues that remain, so the job may go on to approval. */
export async function overrideLaunchFacts(slug: string): Promise<Job> {
  const job = await load(slug);
  job.factOverride = true;
  if (job.stages.factcheck.status === 'blocked') job.stages.factcheck = { status: 'done', at: new Date().toISOString() };
  job.updatedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

export function isLaunchRunning(slug: string): boolean {
  return running.has(slug);
}
