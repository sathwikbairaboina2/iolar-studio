import { cutNotes, scriptWords, trimDecision } from './budget';
import { checkFacts, issuesToNotes } from './factcheck';
import { gateDeps, runProc, type Proc } from './commands';
import { criticNotes, critique, critiqueLoop } from './critic';
import { runDesign } from './design';
import { runGates } from './gates';
import { renderVideo } from './render';
import { STAGES, type Job, type Script, type Stage } from './schema';
import { generateScript, type ClaudeRun } from './script';
import { writeSound } from './sound';
import { renderStrips, type Strip } from './strips';
import { readBrief, readFactcheck, readJob, readScript, readTiming, writeCritic, writeFactcheck, writeJob, writeScript } from './store';
import { speakBeats } from './voice';
import { renderRoot } from './workspace';
import type { HeardWord } from './words';

/**
 * One job per explainer, resumable per stage: its state lives in job.json, a stage that is `done` is not run again,
 * and re-running an earlier stage marks every later one pending, because their inputs changed.
 *
 *   script -> factcheck -> voice -> design -> gates -> critic -> render
 */

export type JobDeps = {
  run: ClaudeRun;
  speak: (text: string, mp3Path: string, opts?: { speed?: number }) => Promise<unknown>;
  probe: (file: string) => Promise<number>;
  /** Word timings for a voice clip (whisper). Without it, or when it fails, the captions use an even spread. */
  align?: (mp3: string, text: string) => Promise<HeardWord[]>;
  /** Kokoro speed for the voice; defaults to the explainer pace. */
  speed?: number;
  /** Tiles a beat's six frames into one strip png; defaults to the real one (sharp). */
  tile?: (files: string[], out: string) => Promise<void>;
  proc: Proc;
  /** The Remotion project; defaults to the plugin's render/. */
  root?: string;
  now?: () => Date;
};

/** The real model, voice, ffprobe and processes. Loaded lazily so tests and the page never import them. */
export async function realDeps(): Promise<JobDeps> {
  const [{ runClaude }, { speak }, { ffprobeMedia }, { alignVoice }, { getSettings }] = await Promise.all([
    import('@/lib/ai/claude'),
    import('@/lib/reel/tts'),
    import('@/lib/reel/probe'),
    import('@/lib/reel/align'),
    import('@/lib/settings'),
  ]);
  return {
    run: runClaude,
    speak: (t, p, o) => speak(t, p, o),
    probe: async (f) => (await ffprobeMedia(f)).durationSec,
    align: async (mp3, text) => (await alignVoice(mp3, text)).map((w) => ({ w: w.w, start: w.start, end: w.end })),
    speed: getSettings().explainerKokoroSpeed,
    proc: runProc,
    root: renderRoot(),
  };
}

export class JobError extends Error {}

const WORK = STAGES.filter((s): s is Exclude<Stage, 'brief'> => s !== 'brief');
const running = new Set<string>();

export function nextStage(job: Job): Stage | null {
  return WORK.find((s) => job.stages[s].status !== 'done') ?? null;
}

const stamp = (deps: JobDeps) => (deps.now ?? (() => new Date()))().toISOString();

async function load(slug: string): Promise<Job> {
  const job = await readJob(slug);
  if (!job) throw new JobError(`no explainer called ${slug}`);
  return job;
}

async function save(job: Job, deps: JobDeps): Promise<void> {
  job.updatedAt = stamp(deps);
  await writeJob(job);
}

function mark(job: Job, stage: Stage, status: Job['stages'][Stage]['status'], deps: JobDeps, error?: string) {
  job.stages[stage] = { status, at: stamp(deps), ...(error ? { error } : {}) };
}

function invalidateFrom(job: Job, from: Stage) {
  for (const s of WORK.slice(WORK.indexOf(from as (typeof WORK)[number]))) job.stages[s] = { status: 'pending' };
}

/** Runs one stage; returns false when the job must stop here without failing (the fact check is blocked). */
async function exec(stage: Exclude<Stage, 'brief'>, job: Job, deps: JobDeps): Promise<boolean> {
  const slug = job.slug;
  const brief = (await readBrief(slug))!;
  const root = deps.root ?? renderRoot();

  if (stage === 'script') {
    const previous = job.notes ? ((await readScript(slug)) ?? undefined) : undefined;
    await writeScript(slug, await generateScript(brief, deps, { notes: job.notes || undefined, previous }));
    return true;
  }

  if (stage === 'factcheck') {
    let script = (await readScript(slug))!;
    let result = await checkFacts(script, deps);
    if (!result.ok && !job.factOverride) {
      // One rewrite with the corrections as notes, then one more check. Issues that survive go to a person.
      script = await generateScript(brief, deps, { notes: issuesToNotes(result.issues), previous: script });
      await writeScript(slug, script);
      result = await checkFacts(script, deps);
    }
    await writeFactcheck(slug, result);
    if (!result.ok && !job.factOverride) {
      mark(job, 'factcheck', 'blocked', deps, `${result.issues.length} issue${result.issues.length === 1 ? '' : 's'} left; edit the script or override`);
      return false;
    }
    return true;
  }

  if (stage === 'voice') {
    const voice = { speak: deps.speak, probe: deps.probe, align: deps.align, speed: deps.speed };
    const script = (await readScript(slug))!;
    const timing = await speakBeats(slug, script, voice);
    // The first four videos ran 25 to 50% over their brief. A video over 115% of it gets one rewrite, cut to a word count.
    const cut = trimDecision({ measuredSeconds: timing.totalFrames / timing.fps, seconds: brief.seconds, words: scriptWords(script), rewrites: 0 });
    if (cut.trim) {
      let shorter: Script | null = null;
      try {
        shorter = await generateScript(brief, deps, { notes: cutNotes(cut.targetWords!), previous: script });
      } catch {
        // A rewrite that does not validate leaves the first script and voice in place: a long video is better than none.
      }
      if (shorter) {
        // A cut can change a claim, so the shorter script is checked too; one that fails leaves the checked original in place.
        const check = await checkFacts(shorter, deps);
        if (check.ok || job.factOverride) {
          await writeScript(slug, shorter);
          await writeFactcheck(slug, check);
          await speakBeats(slug, shorter, voice);
        }
      }
    }
    return true;
  }

  if (stage === 'design') {
    const r = await runDesign(slug, { run: deps.run, root }, { notes: job.notes || undefined });
    if (!r.wrote) throw new JobError('the designer did not write Video.tsx');
    return true;
  }

  if (stage === 'gates') {
    const timing = (await readTiming(slug))!;
    let gate = await runGates(timing, gateDeps(slug, root, deps.proc));
    if (!gate.ok) {
      // The design gets one more round, told exactly what failed.
      await runDesign(slug, { run: deps.run, root }, { notes: job.notes || undefined, gateErrors: gate.errors });
      gate = await runGates(timing, gateDeps(slug, root, deps.proc));
    }
    if (!gate.ok) throw new JobError(gate.errors.join('\n'));
    return true;
  }

  if (stage === 'critic') {
    const timing = (await readTiming(slug))!;
    const script = (await readScript(slug))!;
    let strips: Strip[] = [];
    const record = await critiqueLoop({
      critique: async () => {
        strips = await renderStrips(slug, timing, { proc: deps.proc, root, tile: deps.tile });
        return critique({ run: deps.run, root }, { script, timing, strips });
      },
      // One design round with the critic's fixes (and the strips to look at), checked by the same gates as the first.
      fix: async (fixes, low) => {
        const notes = [job.notes, criticNotes(fixes, low)].filter(Boolean).join('\n\n');
        await runDesign(slug, { run: deps.run, root }, { notes, strips });
        let gate = await runGates(timing, gateDeps(slug, root, deps.proc));
        if (!gate.ok) {
          await runDesign(slug, { run: deps.run, root }, { notes, gateErrors: gate.errors });
          gate = await runGates(timing, gateDeps(slug, root, deps.proc));
        }
        if (!gate.ok) throw new JobError(gate.errors.join('\n'));
      },
    });
    await writeCritic(slug, record);
    return true;
  }

  // render
  if ((await readFactcheck(slug))?.ok === false && !job.factOverride) throw new JobError('the fact check still has issues; edit the script or override');
  job.renderId = await renderVideo(slug, { proc: deps.proc, root });
  job.notes = '';
  return true;
}

export type RunOpts = {
  /** Start here instead of at the first stage that is not done. Runs this stage and every later one. */
  from?: Stage;
  /** Run just this stage and leave the others as they are. */
  only?: Stage;
};

/**
 * Runs the pending stages in order and saves after each. A failed stage is recorded in job.json and stops the run;
 * the job is returned either way, so the caller reads the outcome off the stages.
 */
export async function runJob(slug: string, deps: JobDeps, opts: RunOpts = {}): Promise<Job> {
  if (running.has(slug)) throw new JobError(`${slug} is already running`);
  running.add(slug);
  try {
    const job = await load(slug);
    const only = opts.only && opts.only !== 'brief' ? opts.only : undefined;
    const first = only ?? (opts.from && opts.from !== 'brief' ? opts.from : nextStage(job));
    if (!first) return job;
    const from = WORK.indexOf(first as (typeof WORK)[number]);
    const to = only ? from : WORK.length - 1;
    if (!only) invalidateFrom(job, first);

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

/** Notes from the UI. Wording notes rewrite the script (and so redo everything after it); visual notes redo only the design. */
export async function reviseJob(slug: string, notes: string, kind: 'wording' | 'visual'): Promise<Job> {
  const job = await load(slug);
  invalidateFrom(job, kind === 'wording' ? 'script' : 'design');
  job.notes = notes.trim();
  if (kind === 'wording') job.factOverride = false;
  job.updatedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

/** A person chose another music bed: only the render is redone (the design and the strips do not depend on it). */
export async function changeBed(slug: string, bed: string | null): Promise<Job> {
  const job = await load(slug);
  await writeSound(slug, { bed });
  invalidateFrom(job, 'render');
  job.updatedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

/** A person edited the script: it counts as done, but the fact check and everything after it must run again on the new words. */
export async function scriptEdited(slug: string): Promise<Job> {
  const job = await load(slug);
  invalidateFrom(job, 'factcheck');
  job.stages.script = { status: 'done', at: new Date().toISOString() };
  job.factOverride = false;
  job.updatedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

/** A person accepts the fact-check issues that remain, so the job may go on to voice and design. */
export async function overrideFacts(slug: string): Promise<Job> {
  const job = await load(slug);
  job.factOverride = true;
  if (job.stages.factcheck.status === 'blocked') job.stages.factcheck = { status: 'done', at: new Date().toISOString() };
  job.updatedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

export function isRunning(slug: string): boolean {
  return running.has(slug);
}
