/**
 * Where a generated shot comes from.
 *
 * The studio used to drive a local ComfyUI here through a bundled
 * image-to-video template. That code is gone: generation belongs to the user,
 * who has their own plugins to hand over. What is left is the seam it hung on.
 *
 * Nothing is registered by default, so `videoProvider()` returns null and every
 * beat that would have been generated is marked `awaiting-manual` instead. That
 * is the same state an unreachable backend produced before, which is why the
 * rest of the pipeline — assemble, preview, export — needs no cases for it: a
 * dropped file finishes the reel exactly as it always did.
 *
 * To wire a plugin, call `registerVideoProvider` once at startup.
 */

export type AnimateRequest = {
  /** Absolute path to the still the shot animates from. */
  imagePath: string;
  /** What the shot should show, in the beat's own words. */
  brief: string;
  seconds: number;
  seed: number;
  ratio: string;
};

export type JobState = 'running' | 'ready' | 'failed';

export interface VideoProvider {
  /** Shown in errors and on the asset, so a reel records what made each clip. */
  readonly name: string;
  /** False when the backend is down; the beat then waits for a human. */
  available(): Promise<boolean>;
  /** Queues one shot and returns the id to poll. */
  animate(req: AnimateRequest): Promise<{ jobId: string }>;
  jobState(jobId: string): Promise<JobState>;
  /** Writes the finished clip to `dest`. */
  collect(jobId: string, dest: string): Promise<void>;
}

let registered: VideoProvider | null = null;

export function registerVideoProvider(provider: VideoProvider | null): void {
  registered = provider;
}

export function videoProvider(): VideoProvider | null {
  return registered;
}

/** The message a beat carries while no plugin is wired. */
export const NO_PROVIDER =
  'No video provider is wired — drop a clip on this beat, or register your plugin.';
