import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Route = { status?: number; body?: unknown; bytes?: Uint8Array };

/** A service made of canned answers. A route given a list answers each call with the next one. */
const service = (routes: Record<string, Route | Route[]>) => {
  const seen: string[] = [];
  const f = vi.fn(async (url: string) => {
    const pathname = new URL(String(url)).pathname;
    seen.push(pathname);
    const entry = routes[pathname];
    const r = Array.isArray(entry) ? (entry.length > 1 ? entry.shift()! : entry[0]) : (entry ?? { status: 404 });
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
      text: async () => '',
      arrayBuffer: async () => (r.bytes ?? new Uint8Array([1, 2, 3])).buffer,
    } as Response;
  }) as unknown as typeof fetch;
  return { f, seen };
};

const opts = (f: typeof fetch) => ({ baseUrl: 'http://x', fetchImpl: f });
const JOB = (state: string, extra: Record<string, unknown> = {}) => ({ body: { state, progress: 0.5, ...extra } });
const TIMELINE = { totalFrames: 450, fps: 30 };

const load = async () => {
  const renders = await import('@/lib/explainer/renders');
  const store = await import('@/lib/explainer/store');
  return { renders, store };
};

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'explainer-renders-'));
  vi.resetModules();
});

describe('starting a render', () => {
  it('writes a queued record carrying the hash of what was sent', async () => {
    const { f } = service({ '/validate': { body: {} }, '/jobs': { body: { id: 'j1' } } });
    const { renders, store } = await load();
    const doc = await store.save('x', store.blankDoc('Indexes'));

    const rec = await renders.start('x', doc, opts(f));
    expect(rec).toMatchObject({ id: 'j1', state: 'queued', docHash: renders.hashDoc(doc), title: 'Indexes' });
    expect(rec.finishedAt).toBeNull();

    const log = await renders.read('x', doc);
    expect(log.renders).toHaveLength(1);
    expect(log.live).toBe(true);
  });

  it('refuses a document the service rejects, without writing a record', async () => {
    const { f } = service({ '/validate': { status: 422, body: { detail: [{ loc: ['body', 'scene'], msg: 'no' }] } } });
    const { renders, store } = await load();
    const doc = await store.save('x', store.blankDoc('Indexes'));

    await expect(renders.start('x', doc, opts(f))).rejects.toThrow();
    expect((await renders.read('x', doc)).renders).toHaveLength(0);
  });
});

describe('polling', () => {
  it('mirrors a running job and keeps it live', async () => {
    const { f } = service({ '/validate': { body: {} }, '/jobs': { body: { id: 'j1' } }, '/jobs/j1': JOB('rendering') });
    const { renders, store } = await load();
    const doc = await store.save('x', store.blankDoc('Indexes'));
    await renders.start('x', doc, opts(f));

    const log = await renders.poll('x', opts(f));
    expect(log.renders[0]).toMatchObject({ state: 'rendering', progress: 0.5, finishedAt: null });
    expect(log.live).toBe(true);
  });

  it('brings the mp4 home before it writes the record done', async () => {
    const { f } = service({
      '/validate': { body: {} },
      '/jobs': { body: { id: 'j1' } },
      '/jobs/j1': JOB('done', { timeline: TIMELINE }),
      '/jobs/j1/reel.mp4': { bytes: new Uint8Array([9, 9, 9, 9]) },
    });
    const { renders, store } = await load();
    const { explainerRenderMp4 } = await import('@/lib/paths');
    const doc = await store.save('x', store.blankDoc('Indexes'));
    await renders.start('x', doc, opts(f));

    const log = await renders.poll('x', opts(f));
    expect(log.renders[0]).toMatchObject({ state: 'done', seconds: 15, frames: 450 });
    expect(log.renders[0].finishedAt).not.toBeNull();
    expect(log.live).toBe(false);
    expect((await fs.stat(explainerRenderMp4('x', 'j1'))).size).toBe(4);
  });

  it('keeps the reason a job failed, and stops treating it as live', async () => {
    const { f } = service({
      '/validate': { body: {} }, '/jobs': { body: { id: 'j1' } },
      '/jobs/j1': JOB('failed', { error: 'the renderer ran out of memory' }),
    });
    const { renders, store } = await load();
    const doc = await store.save('x', store.blankDoc('Indexes'));
    await renders.start('x', doc, opts(f));

    const log = await renders.poll('x', opts(f));
    expect(log.renders[0]).toMatchObject({ state: 'failed', error: 'the renderer ran out of memory' });
    expect(log.live).toBe(false);
  });

  it('asks about nothing when nothing is live', async () => {
    const { f, seen } = service({
      '/validate': { body: {} }, '/jobs': { body: { id: 'j1' } },
      '/jobs/j1': JOB('failed', { error: 'no' }),
    });
    const { renders, store } = await load();
    const doc = await store.save('x', store.blankDoc('Indexes'));
    await renders.start('x', doc, opts(f));
    await renders.poll('x', opts(f));
    const before = seen.length;

    await renders.poll('x', opts(f));
    expect(seen.length).toBe(before);
  });
});

describe('the log itself', () => {
  it('drops the oldest past the limit, and its mp4 with it', async () => {
    const { renders, store } = await load();
    const { explainerRenderMp4 } = await import('@/lib/paths');
    const doc = await store.save('x', store.blankDoc('Indexes'));

    for (let n = 1; n <= renders.KEEP + 1; n += 1) {
      const { f } = service({
        '/validate': { body: {} }, '/jobs': { body: { id: `j${n}` } },
        [`/jobs/j${n}`]: JOB('done', { timeline: TIMELINE }),
        [`/jobs/j${n}/reel.mp4`]: { bytes: new Uint8Array([1]) },
      });
      await renders.start('x', doc, opts(f));
      await renders.poll('x', opts(f));
    }

    const log = await renders.read('x', doc);
    expect(log.renders).toHaveLength(renders.KEEP);
    expect(log.renders.map((r) => r.id)).not.toContain('j1');
    await expect(fs.stat(explainerRenderMp4('x', 'j1'))).rejects.toThrow();
  });

  it('newest first, and latestDone looks past a newer failure', async () => {
    const { renders, store } = await load();
    const doc = await store.save('x', store.blankDoc('Indexes'));

    const ok = service({
      '/validate': { body: {} }, '/jobs': { body: { id: 'good' } },
      '/jobs/good': JOB('done', { timeline: TIMELINE }), '/jobs/good/reel.mp4': { bytes: new Uint8Array([1]) },
    });
    await renders.start('x', doc, opts(ok.f));
    await renders.poll('x', opts(ok.f));

    const bad = service({
      '/validate': { body: {} }, '/jobs': { body: { id: 'bad' } },
      '/jobs/bad': JOB('failed', { error: 'nope' }),
    });
    await renders.start('x', doc, opts(bad.f));
    await renders.poll('x', opts(bad.f));

    const log = await renders.read('x', doc);
    expect(log.renders.map((r) => r.id)).toEqual(['bad', 'good']);
    expect((await renders.latestDone('x'))?.id).toBe('good');
  });

  it('an edit after the render makes that record read as from an older document', async () => {
    const { f } = service({
      '/validate': { body: {} }, '/jobs': { body: { id: 'j1' } },
      '/jobs/j1': JOB('done', { timeline: TIMELINE }), '/jobs/j1/reel.mp4': { bytes: new Uint8Array([1]) },
    });
    const { renders, store } = await load();
    const doc = await store.save('x', store.blankDoc('Indexes'));
    await renders.start('x', doc, opts(f));
    await renders.poll('x', opts(f));

    const edited = await store.save('x', { ...doc, theme: 'paper' });
    const log = await renders.read('x', edited);
    expect(log.currentHash).toBe(renders.hashDoc(edited));
    expect(log.renders[0].docHash).not.toBe(log.currentHash);
  });
});

describe('stopping one', () => {
  it('tells the service to drop the job and writes down why the record ended', async () => {
    const { f, seen } = service({
      '/validate': { body: {} }, '/jobs': { body: { id: 'j1' } }, '/jobs/j1': { body: {} },
    });
    const { renders, store } = await load();
    const doc = await store.save('x', store.blankDoc('Indexes'));
    await renders.start('x', doc, opts(f));

    const log = await renders.cancel('x', 'j1', opts(f));
    expect(seen).toContain('/jobs/j1');
    expect(log.renders[0]).toMatchObject({ state: 'failed', error: 'stopped here' });
    expect(log.live).toBe(false);
  });

  it('leaves a finished render alone, and asks the service nothing about it', async () => {
    const { f } = service({
      '/validate': { body: {} }, '/jobs': { body: { id: 'j1' } },
      '/jobs/j1': JOB('done', { timeline: TIMELINE }), '/jobs/j1/reel.mp4': { bytes: new Uint8Array([1]) },
    });
    const { renders, store } = await load();
    const doc = await store.save('x', store.blankDoc('Indexes'));
    await renders.start('x', doc, opts(f));
    await renders.poll('x', opts(f));

    const quiet = service({});
    const log = await renders.cancel('x', 'j1', opts(quiet.f));
    expect(quiet.seen).toEqual([]);
    expect(log.renders[0].state).toBe('done');
  });
});
