import { approveLaunch, isLaunchRunning, overrideLaunchFacts, realLaunchDeps, reviseLaunch, runLaunch, type LaunchRunOpts } from './job';

export class LaunchAlreadyRunning extends Error {
  constructor(slug: string) {
    super(`${slug} is already running`);
    this.name = 'LaunchAlreadyRunning';
  }
}

/**
 * Starts the job and returns at once: a run takes minutes, and its state is in job.json, which the page polls.
 * A failure is recorded on the stage by the job itself; anything that escapes it is logged here.
 */
export async function startLaunch(slug: string, opts: LaunchRunOpts = {}): Promise<void> {
  if (isLaunchRunning(slug)) throw new LaunchAlreadyRunning(slug);
  const deps = await realLaunchDeps();
  void runLaunch(slug, deps, opts).catch((err) => console.error('[instastudio] launch run failed', slug, err));
}

/** Approves the script, then carries on to voice and the render. */
export async function startApprove(slug: string): Promise<void> {
  if (isLaunchRunning(slug)) throw new LaunchAlreadyRunning(slug);
  await approveLaunch(slug);
  await startLaunch(slug);
}

/** Records revision notes (which resets the stages they affect), then runs. */
export async function startLaunchRevise(slug: string, notes: string, kind: 'wording' | 'visual'): Promise<void> {
  if (isLaunchRunning(slug)) throw new LaunchAlreadyRunning(slug);
  await reviseLaunch(slug, notes, kind);
  await startLaunch(slug);
}

/** Accepts the fact-check issues that remain, then carries on. */
export async function startLaunchOverride(slug: string): Promise<void> {
  if (isLaunchRunning(slug)) throw new LaunchAlreadyRunning(slug);
  await overrideLaunchFacts(slug);
  await startLaunch(slug);
}
