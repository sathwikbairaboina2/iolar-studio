import { isRunning, realDeps, reviseJob, runJob, overrideFacts, type RunOpts } from './job';

export class AlreadyRunning extends Error {
  constructor(slug: string) {
    super(`${slug} is already running`);
    this.name = 'AlreadyRunning';
  }
}

/**
 * Starts the job and returns at once: a run takes minutes, and its state is in job.json, which the page polls.
 * A failure is recorded on the stage by the job itself; anything that escapes it is logged here.
 */
export async function startRun(slug: string, opts: RunOpts = {}): Promise<void> {
  if (isRunning(slug)) throw new AlreadyRunning(slug);
  const deps = await realDeps();
  void runJob(slug, deps, opts).catch((err) => console.error('[instastudio] explainer2 run failed', slug, err));
}

/** Records revision notes (which resets the stages they affect), then runs. */
export async function startRevise(slug: string, notes: string, kind: 'wording' | 'visual'): Promise<void> {
  if (isRunning(slug)) throw new AlreadyRunning(slug);
  await reviseJob(slug, notes, kind);
  await startRun(slug);
}

/** Accepts the fact-check issues that remain, then carries on. */
export async function startOverride(slug: string): Promise<void> {
  if (isRunning(slug)) throw new AlreadyRunning(slug);
  await overrideFacts(slug);
  await startRun(slug);
}
