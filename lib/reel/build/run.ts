import { promises as fs } from 'fs';
import { loadReel } from '../store';
import { reelVoFile } from '@/lib/paths';
import * as research from '../research/store';
import { buildBeatsFromScript } from './bridge';
import { beatAudioDir, sliceBeatAudio } from './audio';
import { runShots } from '../shots';
import { synthesizeVoice, alignExistingVoice } from '../voice';
import '../providers';

/**
 * Approved script to queued renders, one stage per call.
 *
 * The same shape as the research workflow, for the same reason: every stage here
 * is minutes long and can fail on its own, so the state lives on disk and a
 * closed tab costs nothing. A caller that wants the whole thing runs `auto`,
 * which is the same steps in a loop — automation is a caller's choice, not a
 * second implementation.
 *
 * The state is derived rather than stored. Beats carrying a source line mean the
 * bridge ran; a voiceover file means there is audio; word timings mean it was
 * aligned; files in the beat-audio folder mean it was cut. Nothing can drift out
 * of step with the files it describes.
 */

export type BuildStage = 'unbuilt' | 'bridged' | 'voiced' | 'aligned' | 'sliced' | 'rendering' | 'stalled' | 'done';

export type BuildState = {
  stage: BuildStage;
  beats: number;
  /** Beats a renderer owns; a title card is not one of them. */
  renderable: number;
  queued: number;
  ready: number;
  failed: number;
  awaitingManual: number;
};

const exists = (p: string) => fs.stat(p).then(() => true).catch(() => false);

export async function buildState(slug: string): Promise<BuildState> {
  const reel = await loadReel(slug);
  const bridged = reel.beats.some((b) => b.shot.sourceLineId);
  const generatable = reel.beats.filter((b) => b.shot.kind === 'screen' || b.shot.kind === 'talking-head');

  // Only what a beat currently points at. A retry leaves the previous attempt
  // behind, and counting orphans would report failures the reel has moved past.
  const live = new Set(reel.beats.map((b) => b.shot.assetId).filter(Boolean));
  const assets = reel.assets.filter((a) => a.origin === 'plugin' && live.has(a.id));
  const counts = {
    queued: assets.filter((a) => a.status === 'queued' || a.status === 'running').length,
    ready: assets.filter((a) => a.status === 'ready').length,
    failed: assets.filter((a) => a.status === 'failed').length,
    awaitingManual: assets.filter((a) => a.status === 'awaiting-manual').length,
  };

  const base = { beats: reel.beats.length, renderable: generatable.length, ...counts };

  if (!bridged) return { stage: 'unbuilt', ...base };
  if (!(await exists(reelVoFile(slug)))) return { stage: 'bridged', ...base };
  if (!reel.vo.words.length) return { stage: 'voiced', ...base };

  const cut = await fs.readdir(beatAudioDir(slug)).catch(() => [] as string[]);
  if (cut.length === 0) return { stage: 'aligned', ...base };
  if (assets.length === 0) return { stage: 'sliced', ...base };
  if (counts.queued > 0) return { stage: 'rendering', ...base };
  // Nothing running is not the same as everything working: a run where every
  // shot failed used to report done, and stop.
  if (counts.ready < generatable.length) return { stage: 'stalled', ...base };
  return { stage: 'done', ...base };
}

export type VoiceSource = 'tts' | 'supplied';

/**
 * Advances the build one stage and says where it got to.
 *
 * `voice` decides only what happens at the `bridged` stage: synthesise the
 * narration locally, or use the file the user already uploaded. Everything after
 * that is identical, because whisper aligns a file the same way whoever made it.
 */
export async function advanceBuild(slug: string, voice: VoiceSource = 'supplied'): Promise<BuildState> {
  const state = await buildState(slug);

  switch (state.stage) {
    case 'unbuilt': {
      const script = await research.readScript(slug);
      if (script.status !== 'approved') {
        throw new Error('the script is not approved yet — a reel is built from words you have signed off');
      }
      await buildBeatsFromScript(slug, script);
      break;
    }

    case 'bridged': {
      if (voice === 'tts') {
        // Synthesise and align in one pass: this is what the voice route does.
        await synthesizeVoice(slug);
      } else {
        throw new Error('no voiceover yet — upload one, or build with voice=tts to synthesise it here');
      }
      break;
    }

    case 'voiced':
      // A supplied file lands unaligned; whisper places the words on it.
      await alignExistingVoice(slug);
      break;

    case 'sliced':
    case 'aligned': {
      if (state.stage === 'aligned') {
        await sliceBeatAudio(slug, await loadReel(slug));
        break;
      }
      await runShots(slug);
      break;
    }

    case 'rendering':
    case 'stalled':
    case 'done':
      break;
  }

  return buildState(slug);
}

/**
 * Runs the build to completion, or to the first thing that needs a person.
 *
 * Bounded rather than `while (true)`: each stage advances once, so a stage that
 * silently fails to move cannot spin. `rendering` is a resting point — the jobs
 * are with the plugins by then, and the boards poll them.
 */
export async function buildAll(slug: string, voice: VoiceSource = 'supplied'): Promise<BuildState> {
  let state = await buildState(slug);
  const resting = new Set<BuildStage>(['rendering', 'stalled', 'done']);
  for (let i = 0; i < 8 && !resting.has(state.stage); i += 1) {
    const before = state.stage;
    state = await advanceBuild(slug, voice);
    if (state.stage === before) break;
  }
  return state;
}
