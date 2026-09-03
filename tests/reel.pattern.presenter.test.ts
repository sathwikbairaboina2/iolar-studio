import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { seedPatternReel, fetchTemplates, fakeProvider } from './helpers/pattern';

const opts = { baseUrl: 'http://x', fetchImpl: fetchTemplates };
const fakeRun = (async (_c: string, args: string[]) => {
  writeFileSync(args.at(-1)!, 'wav');
  return { stdout: '', stderr: '' };
}) as never;

describe('presenter for a pattern reel', () => {
  beforeEach(async () => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'pres-'));
    vi.resetModules();
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ presenterImage: 'C:/img/face.png' });
  });

  it('cuts the hook span from the voice into pattern/hook.wav', async () => {
    await seedPatternReel({ sections: true, voice: true, words: true });
    const { cutHookAudio } = await import('@/lib/reel/pattern/presenter');
    const runs: string[][] = [];
    const run = (async (_cmd: string, args: string[]) => {
      runs.push(args);
      writeFileSync(args.at(-1)!, 'wav');
      return { stdout: '', stderr: '' };
    }) as never;
    const cut = await cutHookAudio('t', { run, templates: opts });
    expect(cut.file).toMatch(/pattern[\\/]hook\.wav$/);
    expect(cut.start).toBe(0);
    expect(cut.end).toBeGreaterThan(1);
    expect(runs[0]).toContain('-ss');
  });

  it('submits the hook audio to lipsync, records the asset on the hook section, and collects it when ready', async () => {
    await seedPatternReel({ sections: true, voice: true, words: true });
    const { startPresenter, refreshPresenter, presenterState } = await import('@/lib/reel/pattern/presenter');
    const { loadReel } = await import('@/lib/reel/store');
    const provider = fakeProvider(['running', 'ready']);
    const started = await startPresenter('t', { ...opts, provider, run: fakeRun });
    expect(started.status).toBe('queued');
    expect((provider.animated[0] as { imagePath: string }).imagePath).toBe('C:/img/face.png');
    const hook = (await loadReel('t')).pattern!.sections[0] as { assetId?: string };
    expect(hook.assetId).toBeTruthy();
    expect((await refreshPresenter('t', { provider })).status).toBe('running');
    const done = await refreshPresenter('t', { provider });
    expect(done.status).toBe('ready');
    const reel = await loadReel('t');
    const asset = reel.assets.find((a) => a.id === hook.assetId)!;
    expect(asset.status).toBe('ready');
    expect(existsSync(path.join(process.env.IOLAR_DATA_DIR!, 'reel', 't', asset.path))).toBe(true);
    expect((await presenterState('t')).status).toBe('ready');
  });

  it('is blocked, not failed, when lipsync is down; an upload wins over lipsync', async () => {
    await seedPatternReel({ sections: true, voice: true, words: true });
    const { startPresenter, presenterState, saveUploadedPresenter, clearUploadedPresenter } = await import('@/lib/reel/pattern/presenter');
    const { loadReel } = await import('@/lib/reel/store');
    const down = { ...fakeProvider(), async available() { return false; } };
    const s = await startPresenter('t', { ...opts, provider: down });
    expect(s.status).toBe('none');
    expect(s.blocked).toMatch(/lipsync|upload/);
    await saveUploadedPresenter('t', Buffer.from('mp4'));
    expect((await loadReel('t')).pattern?.presenter).toBe('upload');
    expect(await presenterState('t')).toMatchObject({ source: 'upload', status: 'ready' });
    await clearUploadedPresenter('t');
    expect((await loadReel('t')).pattern?.presenter).toBe('lipsync');
  });
});
