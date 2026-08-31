/**
 * Where a generated shot comes from.
 *
 * The studio used to drive a local ComfyUI here through a bundled
 * image-to-video template. That code is gone: generation belongs to the user,
 * who built the renderers this now routes to. What survived is the seam it hung
 * on, widened from one provider to a registry — because a researched reel has
 * two kinds of shot and they are made by different machines.
 *
 * A `screen` beat is a page visit: a real browser scrolling the source that
 * proves the line, which is why text stays readable where a diffusion model
 * would melt it. A `talking-head` beat is a lipsync render from one reference
 * image and that beat's slice of the voiceover. A `title` beat is an overlay and
 * is never queued.
 *
 * Nothing is registered by default, so a studio with no plugins running marks
 * beats `awaiting-manual` and a dropped file still finishes the reel — the same
 * behaviour as before, for the same reason.
 */

import type { ShotKind } from './schema';

export type AnimateRequest = {
  /** Where the finished audio for this beat lives. Both renderers need it. */
  audioPath: string;
  seconds: number;
  seed: number;
  ratio: string;
  /** What the shot should show, in the beat's own words. */
  brief: string;

  /** Page visits: the source that proves the line, and the phrase to sweep. */
  url?: string;
  highlight?: string;

  /** Lipsync: the presenter to animate. */
  imagePath?: string;
};

/**
 * `gone` is not a failure of the render — it is the renderer saying it has never
 * heard of this job, or no longer has it. Treating that as "try again later"
 * leaves the asset running for ever and the reel never reports itself stuck.
 */
export type JobState = 'running' | 'ready' | 'failed' | 'gone';

export interface VideoProvider {
  /** Recorded on the asset, so a reel says which machine made each clip. */
  readonly name: string;
  /** False when the backend is down; the beat then waits for a human. */
  available(): Promise<boolean>;
  animate(req: AnimateRequest): Promise<{ jobId: string }>;
  jobState(jobId: string): Promise<JobState>;
  /** Writes the finished clip to `dest`. */
  collect(jobId: string, dest: string): Promise<void>;
}

const registered = new Map<string, VideoProvider>();

export function registerVideoProvider(name: string, provider: VideoProvider | null): void {
  if (provider) registered.set(name, provider);
  else registered.delete(name);
}

export function videoProvider(name: string): VideoProvider | null {
  return registered.get(name) ?? null;
}

export function registeredProviders(): string[] {
  return [...registered.keys()];
}

/**
 * Which renderer owns a shot kind.
 *
 * `title` returns null because a title card is drawn by the pattern over
 * whatever is behind it; it has never been generated and is not missing.
 */
export function providerNameFor(kind: ShotKind): string | null {
  if (kind === 'screen') return 'webpage';
  if (kind === 'talking-head') return 'lipsync';
  return null;
}

/** The message a beat carries while no plugin is wired. */
export const NO_PROVIDER =
  'No video provider is wired — drop a clip on this beat, or register your plugin.';
