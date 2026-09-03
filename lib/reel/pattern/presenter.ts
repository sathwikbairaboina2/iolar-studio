import { promises as fs } from 'fs';
import path from 'path';
import { loadReel, saveReel, addAsset, updateAsset } from '../store';
import { run as runProbe } from '../probe';
import { getSettings } from '@/lib/settings';
import { reelAssetsDir, reelDir, reelPatternDir, reelPatternHookAudio, reelPresenterFile, reelVoFile } from '@/lib/paths';
import { videoProvider, type VideoProvider } from '../videoProvider';
import '../providers';
import { buildDocument } from './document';
import type { ServiceOpts } from './service';

/**
 * The hook's presenter clip. By default the lipsync desk animates the settings presenter
 * image over the hook's own audio; a clip the user drops at presenter.mp4 wins over that
 * and skips the render. Nothing here trims: the service trims a longer clip from its start.
 */

export type PresenterState = {
  source: 'upload' | 'lipsync';
  status: 'none' | 'queued' | 'running' | 'ready' | 'failed';
  assetId?: string;
  error?: string;
  /** Why the stage cannot proceed; the board shows it and offers the upload. */
  blocked?: string;
};

const exists = (p: string) => fs.stat(p).then(() => true).catch(() => false);
type HookSection = { kind: 'hook'; assetId?: string } & Record<string, unknown>;
const hookOf = (sections: unknown[]) => sections.find((s) => (s as { kind?: string }).kind === 'hook') as HookSection | undefined;

export async function presenterState(slug: string): Promise<PresenterState> {
  const reel = await loadReel(slug);
  if (!reel.pattern) return { source: 'lipsync', status: 'none', blocked: 'not a pattern reel' };
  if (await exists(reelPresenterFile(slug))) return { source: 'upload', status: 'ready' };
  const hook = hookOf(reel.pattern.sections);
  const asset = hook?.assetId ? reel.assets.find((a) => a.id === hook.assetId) : undefined;
  if (!asset) return { source: 'lipsync', status: 'none' };
  const status = asset.status === 'awaiting-manual' ? 'failed' : asset.status;
  return { source: 'lipsync', status, assetId: asset.id, ...(asset.error ? { error: asset.error } : {}) };
}

/** The hook unit's stretch of the voice, mono 16 kHz as the lipsync encoder reads it. */
export async function cutHookAudio(slug: string, deps: { run?: typeof runProbe; templates?: ServiceOpts } = {}): Promise<{ file: string; start: number; end: number }> {
  const built = await buildDocument(slug, deps.templates);
  if (!built.measured) throw new Error('the voice is not aligned yet, so the hook has no span to cut');
  const hook = built.times.find((u) => u.kind === 'hook');
  if (!hook) throw new Error('the sections have no hook');
  await fs.mkdir(reelPatternDir(slug), { recursive: true });
  const file = reelPatternHookAudio(slug);
  await (deps.run ?? runProbe)('ffmpeg', [
    '-y', '-ss', hook.start.toFixed(3), '-t', Math.max(0.5, hook.end - hook.start).toFixed(3), '-i', reelVoFile(slug),
    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', file,
  ]);
  return { file, start: hook.start, end: hook.end };
}

export async function startPresenter(slug: string, deps: { provider?: VideoProvider | null; run?: typeof runProbe } & ServiceOpts = {}): Promise<PresenterState> {
  const reel = await loadReel(slug);
  if (!reel.pattern) throw new Error(`${slug} has no pattern`);
  if (await exists(reelPresenterFile(slug))) return { source: 'upload', status: 'ready' };
  const provider = deps.provider === undefined ? videoProvider('lipsync') : deps.provider;
  if (!provider || !(await provider.available())) {
    return { source: 'lipsync', status: 'none', blocked: 'lipsync is down — start it from Plugins, or upload a hook clip' };
  }
  const settings = getSettings();
  if (!settings.presenterImage) return { source: 'lipsync', status: 'none', blocked: 'no presenter image is set — choose one in settings, or upload a hook clip' };

  const { file, start, end } = await cutHookAudio(slug, { run: deps.run, templates: deps });
  const { jobId } = await provider.animate({
    audioPath: file, seconds: end - start, seed: reel.seed, ratio: reel.ratio, fps: reel.fps,
    brief: 'the hook, spoken to camera', imagePath: settings.presenterImage, steps: settings.lipsyncSteps,
  });
  const asset = await addAsset(slug, { kind: 'video', path: path.join('assets', 'presenter-hook.mp4'), origin: 'plugin', status: 'queued', provider: provider.name, jobId, brief: 'hook presenter' });
  const fresh = await loadReel(slug);
  const sections = fresh.pattern!.sections.map((s) => ((s as { kind?: string }).kind === 'hook' ? { ...s, assetId: asset.id } : s));
  await saveReel(slug, { ...fresh, pattern: { ...fresh.pattern!, sections } });
  return { source: 'lipsync', status: 'queued', assetId: asset.id };
}

export async function refreshPresenter(slug: string, deps: { provider?: VideoProvider | null } = {}): Promise<PresenterState> {
  const state = await presenterState(slug);
  if (state.source === 'upload' || !state.assetId || (state.status !== 'queued' && state.status !== 'running')) return state;
  const reel = await loadReel(slug);
  const asset = reel.assets.find((a) => a.id === state.assetId)!;
  const provider = deps.provider === undefined ? videoProvider(asset.provider ?? 'lipsync') : deps.provider;
  if (!provider || !asset.jobId) return state;
  const job = await provider.jobState(asset.jobId);
  if (job === 'running') {
    if (asset.status !== 'running') await updateAsset(slug, asset.id, { status: 'running' });
    return { ...state, status: 'running' };
  }
  if (job === 'ready') {
    const dest = path.join(reelDir(slug), asset.path);
    await fs.mkdir(reelAssetsDir(slug), { recursive: true });
    await provider.collect(asset.jobId, dest);
    await updateAsset(slug, asset.id, { status: 'ready' });
    return { ...state, status: 'ready' };
  }
  const error = job === 'gone' ? 'the lipsync desk no longer has this job' : 'the lipsync render failed';
  await updateAsset(slug, asset.id, { status: 'failed', error });
  return { ...state, status: 'failed', error };
}

export async function saveUploadedPresenter(slug: string, bytes: Buffer): Promise<void> {
  const reel = await loadReel(slug);
  if (!reel.pattern) throw new Error(`${slug} has no pattern`);
  await fs.mkdir(reelDir(slug), { recursive: true });
  await fs.writeFile(reelPresenterFile(slug), bytes);
  await saveReel(slug, { ...reel, pattern: { ...reel.pattern, presenter: 'upload' } });
}

export async function clearUploadedPresenter(slug: string): Promise<void> {
  const reel = await loadReel(slug);
  await fs.rm(reelPresenterFile(slug), { force: true });
  if (reel.pattern) await saveReel(slug, { ...reel, pattern: { ...reel.pattern, presenter: 'lipsync' } });
}
