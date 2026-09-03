import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { seedPatternReel, fakeProvider, templatesReply, good } from './helpers/pattern';

type Route = { status?: number; body?: unknown; bytes?: Uint8Array };
const service = (routes: Record<string, Route | Route[]>) => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const pathname = new URL(u).pathname;
    const key = Object.keys(routes).find((k) => pathname === k);
    const entry = routes[key ?? ''];
    const r = Array.isArray(entry) ? (entry.length > 1 ? entry.shift()! : entry[0]) : (entry ?? { status: 404, body: {} });
    return {
      ok: (r.status ?? 200) < 400, status: r.status ?? 200,
      json: async () => r.body ?? {}, text: async () => '', arrayBuffer: async () => (r.bytes ?? new Uint8Array()).buffer,
    } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
};
const base = { baseUrl: 'http://x' };
const fakeRun = (async (_c: string, args: string[]) => {
  writeFileSync(args.at(-1)!, 'wav');
  return { stdout: '', stderr: '' };
}) as never;

describe('patternState', () => {
  beforeEach(() => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'run-'));
    vi.resetModules();
  });

  it('walks the stages as files appear', async () => {
    const { f } = service({ '/templates': { body: templatesReply }, '/validate': { body: { durationSec: 31 } } });
    const opts = { ...base, fetchImpl: f };
    const { patternState } = await import('@/lib/reel/pattern/run');
    await seedPatternReel({ approved: false });
    expect(await patternState('t', opts)).toMatchObject({ stage: 'unsectioned', blocked: expect.stringMatching(/approved/) });
    await seedPatternReel({});
    expect((await patternState('t', opts)).stage).toBe('unsectioned');
    await seedPatternReel({ sections: true });
    expect((await patternState('t', opts)).stage).toBe('sectioned');
    await seedPatternReel({ sections: true, voice: true });
    expect((await patternState('t', opts)).stage).toBe('voiced');
    await seedPatternReel({ sections: true, voice: true, words: true });
    const aligned = await patternState('t', opts);
    expect(aligned.stage).toBe('aligned');
    expect(aligned.measured).toBe(true);
    const { reelPresenterFile } = await import('@/lib/paths');
    writeFileSync(reelPresenterFile('t'), 'mp4');
    expect((await patternState('t', opts)).stage).toBe('presented');
  });

  it('flags stale sections and a stale render', async () => {
    const { f } = service({ '/templates': { body: templatesReply } });
    const opts = { ...base, fetchImpl: f };
    const { patternState } = await import('@/lib/reel/pattern/run');
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const { writeScript, readScript } = await import('@/lib/reel/research/store');
    await seedPatternReel({ sections: true, voice: true, words: true });
    const reel = await loadReel('t');
    await saveReel('t', { ...reel, pattern: { ...reel.pattern!, job: { id: 'j1', state: 'done', submittedAt: 'x', docHash: 'old', error: null } } });
    expect((await patternState('t', opts)).renderStale).toBe(true);
    const script = await readScript('t');
    await writeScript('t', { ...script, lines: script.lines.map((l) => (l.id === 'l2' ? { ...l, text: 'The first now runs offline.' } : l)) });
    expect((await patternState('t', opts)).sectionsStale).toBe(true);
  });
});

describe('advancePattern and render', () => {
  beforeEach(() => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'run-'));
    vi.resetModules();
  });

  it('sections, then refuses to voice without a file when voice is supplied', async () => {
    const { f } = service({ '/templates': { body: templatesReply } });
    const { advancePattern } = await import('@/lib/reel/pattern/run');
    await seedPatternReel({});
    const ask = async () => JSON.stringify({ sections: good });
    expect((await advancePattern('t', { ...base, fetchImpl: f, ask })).stage).toBe('sectioned');
    await expect(advancePattern('t', { ...base, fetchImpl: f, voice: 'supplied' })).rejects.toThrow(/upload/);
  });

  it('starts the presenter at aligned and validates, submits and records the job at presented', async () => {
    const { f, calls } = service({ '/templates': { body: templatesReply }, '/validate': { body: { durationSec: 20 } }, '/jobs': { status: 202, body: { id: 'j9' } } });
    const { advancePattern, patternState } = await import('@/lib/reel/pattern/run');
    const { loadReel } = await import('@/lib/reel/store');
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ presenterImage: 'C:/img/face.png' });
    await seedPatternReel({ sections: true, voice: true, words: true });
    const provider = fakeProvider(['ready']);
    const after = await advancePattern('t', { ...base, fetchImpl: f, provider, run: fakeRun });
    expect(after.presenter.status).toBe('ready');
    expect(after.stage).toBe('presented');
    expect((await patternState('t', { ...base, fetchImpl: f, provider })).stage).toBe('presented');
    const rendering = await advancePattern('t', { ...base, fetchImpl: f, provider });
    expect(rendering.stage).toBe('rendering');
    expect(calls.map((c) => `${c.method} ${c.url.replace('http://x', '')}`)).toEqual(expect.arrayContaining(['POST /validate', 'POST /jobs']));
    const job = (await loadReel('t')).pattern!.job!;
    expect(job).toMatchObject({ id: 'j9', state: 'queued' });
    expect(rendering.previewUrl).toBe('http://x/preview/tools/kinetic?job=j9');
  });

  it('refuses to submit while the presenter is missing', async () => {
    const { f } = service({ '/templates': { body: templatesReply }, '/validate': { body: {} } });
    const { renderPattern } = await import('@/lib/reel/pattern/run');
    await seedPatternReel({ sections: true, voice: true, words: true });
    await expect(renderPattern('t', { ...base, fetchImpl: f })).rejects.toThrow(/presenter|hook clip/);
  });

  it('maps a 422 from validate to the unit path and never creates a job', async () => {
    const { f, calls } = service({ '/templates': { body: templatesReply }, '/validate': { status: 422, body: { detail: [{ loc: ['body', 'sections', 0, 'hook', 'title'], msg: 'too long', type: 'x' }] } } });
    const { renderPattern } = await import('@/lib/reel/pattern/run');
    const { reelPresenterFile } = await import('@/lib/paths');
    await seedPatternReel({ sections: true, voice: true, words: true });
    writeFileSync(reelPresenterFile('t'), 'mp4');
    await expect(renderPattern('t', { ...base, fetchImpl: f })).rejects.toMatchObject({ issues: [{ loc: ['sections', 0, 'hook', 'title'] }] });
    expect(calls.some((c) => c.url.endsWith('/jobs'))).toBe(false);
  });

  it('polls the job, downloads the reel on done, and reports failure with its error', async () => {
    const { f } = service({
      '/templates': { body: templatesReply }, '/validate': { body: {} }, '/jobs': { status: 202, body: { id: 'j1' } },
      '/jobs/j1': [
        { body: { state: 'rendering', progress: 0.4, error: null, timeline: null } },
        { body: { state: 'done', progress: 1, error: null, timeline: { durationSec: 20 } } },
      ],
      '/jobs/j1/reel.mp4': { bytes: new TextEncoder().encode('mp4') },
    });
    const { renderPattern, pollRender } = await import('@/lib/reel/pattern/run');
    const { reelPresenterFile, reelExportDir, reelPatternTimelineFile } = await import('@/lib/paths');
    await seedPatternReel({ sections: true, voice: true, words: true });
    writeFileSync(reelPresenterFile('t'), 'mp4');
    await renderPattern('t', { ...base, fetchImpl: f });
    const mid = await pollRender('t', { ...base, fetchImpl: f });
    expect(mid.stage).toBe('rendering');
    expect(mid.progress).toBe(0.4);
    const done = await pollRender('t', { ...base, fetchImpl: f });
    expect(done.stage).toBe('done');
    expect(existsSync(path.join(reelExportDir('t'), 'reel.mp4'))).toBe(true);
    expect(existsSync(reelPatternTimelineFile('t'))).toBe(true);
    expect(done.exportPath).toMatch(/reel\.mp4$/);
  });

  it('carries a failed job and its error', async () => {
    const { f } = service({
      '/templates': { body: templatesReply }, '/validate': { body: {} }, '/jobs': { status: 202, body: { id: 'j2' } },
      '/jobs/j2': { body: { state: 'failed', progress: 0.2, error: 'page did not load: https://x', timeline: null } },
    });
    const { renderPattern, pollRender } = await import('@/lib/reel/pattern/run');
    const { reelPresenterFile } = await import('@/lib/paths');
    await seedPatternReel({ sections: true, voice: true, words: true });
    writeFileSync(reelPresenterFile('t'), 'mp4');
    await renderPattern('t', { ...base, fetchImpl: f });
    const s = await pollRender('t', { ...base, fetchImpl: f });
    expect(s.stage).toBe('failed');
    expect(s.job?.error).toContain('page did not load');
  });
});
