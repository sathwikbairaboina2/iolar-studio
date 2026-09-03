import { promises as fs } from 'fs';
import path from 'path';
import { loadReel, saveReel } from '../store';
import * as research from '../research/store';
import { reelExportDir, reelPatternDir, reelPatternTimelineFile, reelVoFile } from '@/lib/paths';
import { synthesizeVoice, alignExistingVoice } from '../voice';
import type { ReelPattern } from '../schema';
import type { VideoProvider } from '../videoProvider';
import { run as runProbe } from '../probe';
import { buildDocument } from './document';
import { sectionReel, sectionsHash, type SectionDeps } from './section';
import { presenterState, refreshPresenter, startPresenter, type PresenterState } from './presenter';
import * as service from './service';
import { UnitTooLong } from './timing';
import type { UnitTime } from './types';

/**
 * Approved script to rendered reel, one stage per call, the state derived from disk the
 * way the build board's is: sections on the reel, a voice file, word timings, a presenter
 * clip, a job on the service. Nothing here is stored that the files do not already say,
 * so a closed tab costs nothing and nothing drifts.
 */

export type PatternStage = 'unsectioned' | 'sectioned' | 'voiced' | 'aligned' | 'presented' | 'rendering' | 'failed' | 'done';

export type PatternState = {
  stage: PatternStage;
  blocked: string | null;
  /** The script changed since the sections were cut. */
  sectionsStale: boolean;
  /** The document changed since the last job was submitted. */
  renderStale: boolean;
  units: UnitTime[];
  measured: boolean;
  timingError: string | null;
  presenter: PresenterState;
  job: ReelPattern['job'];
  /** 0..1 from the service while a job runs; null otherwise. */
  progress: number | null;
  previewUrl: string | null;
  exportPath: string | null;
  lastError: string | null;
};

export type StateDeps = service.ServiceOpts & { provider?: VideoProvider | null };
export type RunDeps = SectionDeps & { provider?: VideoProvider | null; run?: typeof runProbe; voice?: 'tts' | 'supplied' };

const exists = (p: string) => fs.stat(p).then(() => true).catch(() => false);
const exportFile = (slug: string) => path.join(reelExportDir(slug), 'reel.mp4');
const LIVE = new Set(['queued', 'preparing', 'rendering']);

export async function patternState(slug: string, deps: StateDeps = {}): Promise<PatternState> {
  const reel = await loadReel(slug);
  if (!reel.pattern) throw new Error(`${slug} has no pattern; it is a freeform reel`);
  const p = reel.pattern;
  const state: PatternState = {
    stage: 'unsectioned', blocked: null, sectionsStale: false, renderStale: false, units: [], measured: false, timingError: null,
    presenter: { source: 'lipsync', status: 'none' }, job: p.job, progress: null, previewUrl: null, exportPath: null, lastError: null,
  };

  const script = await research.readScript(slug).catch(() => null);
  if (!script) return { ...state, blocked: 'no research script yet — write and approve one on the Research tab' };
  if (script.status !== 'approved') return { ...state, blocked: 'the script is not approved yet' };

  const sectioned = p.sections.length > 0;
  state.sectionsStale = sectioned && p.scriptHash !== sectionsHash(script);
  if (!sectioned) return state;

  // Timing and staleness of the document come from the same build. The seconds shown are
  // the service's own (POST /validate cuts a voiced document to its words); the local
  // measure stands in when the service cannot be asked.
  try {
    const built = await buildDocument(slug, deps);
    state.units = built.times;
    state.measured = built.measured;
    state.renderStale = Boolean(p.job) && p.job!.docHash !== built.hash;
    if (built.measured) {
      try {
        const tl = (await service.validate(built.doc, deps)) as { sections?: { start: number; end: number }[] };
        const secs = tl.sections ?? [];
        if (secs.length === built.times.length) {
          state.units = built.times.map((u, i) => ({ ...u, start: secs[i].start, end: secs[i].end, sec: Math.round((secs[i].end - secs[i].start) * 1000) / 1000 }));
        }
      } catch (err) {
        if (err instanceof service.ServiceRejected) state.timingError = err.message;
        else if (!(err instanceof service.ServiceDown)) throw err;
      }
    }
  } catch (err) {
    if (err instanceof UnitTooLong) state.timingError = err.message;
    else if (err instanceof service.ServiceDown) state.blocked = err.message;
    else throw err;
  }

  state.presenter = deps.provider === null ? await presenterState(slug) : await refreshPresenter(slug, { provider: deps.provider });
  state.previewUrl = p.job ? service.previewUrl(p.name, p.theme, p.job.id, deps.baseUrl) : null;
  state.exportPath = (await exists(exportFile(slug))) ? exportFile(slug) : null;

  if (!(await exists(reelVoFile(slug)))) return { ...state, stage: 'sectioned' };
  if (!reel.vo.words.length) return { ...state, stage: 'voiced' };
  if (state.presenter.status !== 'ready') return { ...state, stage: 'aligned', blocked: state.blocked ?? state.presenter.blocked ?? null };
  if (!p.job || state.renderStale) return { ...state, stage: 'presented' };
  if (p.job.state === 'failed') return { ...state, stage: 'failed' };
  if (p.job.state === 'done' && state.exportPath) return { ...state, stage: 'done' };
  return { ...state, stage: 'rendering' };
}

/** One step forward; where it got to. The voice fork is the build board's: tts or supplied. */
export async function advancePattern(slug: string, deps: RunDeps = {}): Promise<PatternState> {
  const state = await patternState(slug, deps);
  switch (state.stage) {
    case 'unsectioned':
      if (state.blocked) throw new Error(state.blocked);
      await sectionReel(slug, deps);
      break;
    case 'sectioned':
      if (deps.voice === 'tts') await synthesizeVoice(slug);
      else throw new Error('no voiceover yet — upload one, or advance with voice=tts to synthesise it here');
      break;
    case 'voiced':
      await alignExistingVoice(slug);
      break;
    case 'aligned': {
      const p = await startPresenter(slug, deps);
      if (p.blocked) return { ...(await patternState(slug, deps)), blocked: p.blocked };
      break;
    }
    case 'presented':
      return renderPattern(slug, deps);
    case 'rendering':
      return pollRender(slug, deps);
    case 'failed':
    case 'done':
      return state;
  }
  return patternState(slug, deps);
}

/** Validate, submit, remember the job. Refuses without a presenter: the service would render a fixture face. */
export async function renderPattern(slug: string, deps: service.ServiceOpts & { captions?: boolean } = {}): Promise<PatternState> {
  const built = await buildDocument(slug, { ...deps, captions: deps.captions ?? true });
  if (!built.presenter) throw new Error('no hook clip yet — let lipsync make one, or upload a presenter clip');
  await service.validate(built.doc, deps);
  const { id } = await service.submit(built.doc, deps);
  const reel = await loadReel(slug);
  await saveReel(slug, {
    ...reel,
    pattern: { ...reel.pattern!, job: { id, state: 'queued', submittedAt: new Date().toISOString(), docHash: built.hash, error: null } },
  });
  return patternState(slug, { ...deps, provider: null });
}

/** Mirror the service's word on the job; on done, take the reel and its timeline home. */
export async function pollRender(slug: string, deps: service.ServiceOpts = {}): Promise<PatternState> {
  const reel = await loadReel(slug);
  const job = reel.pattern?.job;
  if (!reel.pattern || !job) return patternState(slug, { ...deps, provider: null });
  const remote = await service.job(job.id, deps);
  const next = { ...job, state: remote.state, error: remote.error };
  // The export belongs to one job; a re-render replaces it. The marker says which job it came from.
  const marker = path.join(reelExportDir(slug), 'reel.job');
  const fetchedFor = await fs.readFile(marker, 'utf8').then((s) => s.trim()).catch(() => null);
  if (remote.state === 'done' && (fetchedFor !== job.id || !(await exists(exportFile(slug))))) {
    await fs.mkdir(reelPatternDir(slug), { recursive: true });
    await service.download(job.id, exportFile(slug), deps);
    await fs.writeFile(reelPatternTimelineFile(slug), JSON.stringify(remote.timeline ?? {}, null, 2));
    await fs.writeFile(marker, job.id);
  }
  await saveReel(slug, { ...reel, pattern: { ...reel.pattern, job: next } });
  const state = await patternState(slug, { ...deps, provider: null });
  return { ...state, progress: LIVE.has(remote.state) ? remote.progress : null };
}
