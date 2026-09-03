import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ResearchJob } from '@/lib/jobs/researchApi';

const sample = (JSON.parse(readFileSync('tests/fixtures/jobs-pool.sample.json', 'utf8')) as { items: ResearchJob[] }).items;

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-submit-'));
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  (await import('@/lib/db')).closeDb();
});

async function preparedCut(n: number) {
  const L = await import('@/lib/jobs/ledger');
  L.upsertPool(
    Array.from({ length: n }, (_, i) => {
      const base = sample[i % sample.length];
      return {
        researchId: 5000 + i,
        familyKey: `${base.familyKey}|${i}`,
        company: base.company,
        title: base.title,
        category: 'india',
        remote: base.remote,
        postedAt: '2026-09-01T10:00:00.000Z',
        raw: { ...base, id: 5000 + i, familyKey: `${base.familyKey}|${i}`, postedAt: '2026-09-01T10:00:00.000Z' },
      };
    }),
    '2026-09-02T00:00:00.000Z'
  );
  L.finishPull(L.startPull({ category: 'india' }, '2026-09-02T00:00:00.000Z'), { fetched: n, added: n, refreshed: 0, closed: 0 });
  const { prepareCut } = await import('@/lib/jobs/cut');
  return prepareCut('weekly', '2026-W36', {
    classify: async (t) => t.map(() => 'other'),
    brief: async () => '# brief',
    filter: { category: 'india', techOnly: false },
    now: new Date('2026-09-02T12:00:00.000Z'),
  });
}

type Call = { url: string; body?: Record<string, unknown> };
const board = (replies: Record<string, { status?: number; body?: unknown; fail?: boolean }>, calls: Call[] = []) => {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
    const key = Object.keys(replies).find((k) => u.endsWith(k) || (k.startsWith('body:') && String(init?.body ?? '').includes(k.slice(5))));
    const r = replies[key ?? ''] ?? { status: 404, body: { ok: false, message: 'no route' } };
    if (r.fail) throw new Error('connect ECONNREFUSED 127.0.0.1:26100');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {} } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe('submitting a cut', () => {
  it('refuses a thin cut without force, before any call', async () => {
    const cut = await preparedCut(5);
    expect(cut.status).toBe('thin');
    const { submitCut } = await import('@/lib/jobs/submit');
    const { f, calls } = board({});
    await expect(submitCut(cut.id, { baseUrl: 'http://x', fetchImpl: f })).rejects.toThrow(/thin .*force/);
    expect(calls).toHaveLength(0);
  });

  it('posts the list, then summarise, plan for the style, script, records the lines, posts them, and starts the build', async () => {
    const cut = await preparedCut(25);
    const { submitCut } = await import('@/lib/jobs/submit');
    const { f, calls } = board({
      '/api/weeks/2026-W36/jobs': { body: { ok: true, week: '2026-W36', counted: 25, rejected: 0 } },
      'body:"stage":"summarise"': { body: { ok: true, message: 'summarised 25 roles' } },
      'body:"stage":"plan"': { body: { ok: true, message: 'planned 10 beats in chalkboard' } },
      'body:"stage":"script"': { body: { ok: true, message: 'wrote 8 lines' } },
      'body:"stage":"build"': { body: { ok: true, message: 'building (pid 1)' } },
      '/api/weeks/2026-W36/script': { body: { ok: true, style: 'chalkboard', world: 'classic', lines: [{ beatId: 'b2', role: 'hook', text: 'Twenty-five roles.' }, { beatId: 'b3', role: 'promise', text: 'Engineers, this is yours.' }] } },
    });
    const spoken: string[] = [];
    const speaker = async (text: string, mp3: string) => {
      spoken.push(text);
      (await import('node:fs')).writeFileSync(mp3, 'mp3-bytes');
      return { provider: 'kokoro' };
    };
    const record = vi.fn(async () => {});
    const out = await submitCut(cut.id, { baseUrl: 'http://x', fetchImpl: f, record, style: 'chalkboard', voice: 'studio', speaker });
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/api/weeks/2026-W36/jobs',
      'http://x/api/weeks/2026-W36/run', 'http://x/api/weeks/2026-W36/run', 'http://x/api/weeks/2026-W36/run',
      'http://x/api/weeks/2026-W36/script', 'http://x/api/weeks/2026-W36/script',
      'http://x/api/weeks/2026-W36/run',
    ]);
    expect(calls[0].body).toMatchObject({ source: { kind: 'studio', cutId: cut.id }, brief: '# brief', force: false });
    expect((calls[0].body!.jobs as unknown[]).length).toBe(25);
    expect(calls[2].body).toEqual({ stage: 'plan', style: 'chalkboard' });
    expect(spoken).toEqual(['Twenty-five roles.', 'Engineers, this is yours.']);
    const posted = calls[5].body as { style: string; provider: string; lines: { beatId: string; text: string; audio: { format: string; base64: string } }[] };
    expect(posted.style).toBe('chalkboard');
    expect(posted.provider).toBe('studio-kokoro');
    expect(posted.lines.map((l) => l.beatId)).toEqual(['b2', 'b3']);
    expect(posted.lines[0].audio).toEqual({ format: 'mp3', base64: Buffer.from('mp3-bytes').toString('base64') });
    expect(out.cut.status).toBe('building');
    expect(out.submissions.map((s) => [s.stage, s.error])).toEqual([
      ['imported', null], ['summarise', null], ['plan', null], ['script', null], ['voice', null], ['build', null],
    ]);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ status: 'building' }), 1);
  });

  it('leaves the voice to the plugin when asked, and still builds', async () => {
    const cut = await preparedCut(25);
    const { submitCut } = await import('@/lib/jobs/submit');
    const { f, calls } = board({
      '/api/weeks/2026-W36/jobs': { body: { ok: true, week: '2026-W36', counted: 25, rejected: 0 } },
      '/api/weeks/2026-W36/run': { body: { ok: true } },
    });
    const out = await submitCut(cut.id, { baseUrl: 'http://x', fetchImpl: f, voice: 'plugin' });
    expect(calls.map((c) => c.url).filter((u) => u.endsWith('/script'))).toEqual([]);
    expect(out.cut.status).toBe('building');
  });

  it('sends the recording dropped on the cut instead of reading the lines, and still builds', async () => {
    const cut = await preparedCut(25);
    const { saveOwnVoice } = await import('@/lib/jobs/ownVoice');
    saveOwnVoice(cut.periodKey, Buffer.from('m4a-bytes'), 'take 3.m4a');
    const { submitCut } = await import('@/lib/jobs/submit');
    const raw: { url: string; method?: string; type?: string; body?: unknown }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      raw.push({ url: u, method: init?.method, type: (init?.headers as Record<string, string> | undefined)?.['content-type'], body: init?.body });
      if (u.includes('/voice')) return { ok: true, status: 200, json: async () => ({ ok: true, week: '2026-W36', seconds: 41.2, bytes: 9, format: 'm4a' }) } as Response;
      return { ok: true, status: 200, json: async () => ({ ok: true, week: '2026-W36', counted: 25, rejected: 0 }) } as Response;
    }) as unknown as typeof fetch;
    const out = await submitCut(cut.id, { baseUrl: 'http://x', fetchImpl: f });
    expect(raw.map((c) => c.url)).toEqual([
      'http://x/api/weeks/2026-W36/jobs',
      'http://x/api/weeks/2026-W36/run', 'http://x/api/weeks/2026-W36/run', 'http://x/api/weeks/2026-W36/run',
      'http://x/api/weeks/2026-W36/voice?format=m4a',
      'http://x/api/weeks/2026-W36/run',
    ]);
    const put = raw[4];
    expect(put.method).toBe('PUT');
    expect(put.type).toBe('application/octet-stream');
    expect(Buffer.from(put.body as Uint8Array).toString()).toBe('m4a-bytes');
    expect(out.cut.status).toBe('building');
    const voice = out.submissions.find((s) => s.stage === 'voice')!;
    expect(voice.error).toBeNull();
    expect(voice.reply).toMatchObject({ provider: 'own', format: 'm4a', seconds: 41.2 });
  });

  it('reads the lines itself when asked to, even with a recording dropped, and refuses voice: own without one', async () => {
    const cut = await preparedCut(25);
    const { saveOwnVoice, clearOwnVoice } = await import('@/lib/jobs/ownVoice');
    const { submitCut, CutNotSubmittable } = await import('@/lib/jobs/submit');
    saveOwnVoice(cut.periodKey, Buffer.from('x'), 'take.wav');
    const { f, calls } = board({
      '/api/weeks/2026-W36/jobs': { body: { ok: true, week: '2026-W36', counted: 25, rejected: 0 } },
      '/api/weeks/2026-W36/run': { body: { ok: true } },
      '/api/weeks/2026-W36/script': { body: { ok: true, style: 'paper-doodle', world: 'classic', lines: [{ beatId: 'b2', role: 'hook', text: 'Hi.' }] } },
    });
    const speaker = async (_t: string, mp3: string) => { (await import('node:fs')).writeFileSync(mp3, 'a'); return { provider: 'kokoro' }; };
    await submitCut(cut.id, { baseUrl: 'http://x', fetchImpl: f, voice: 'studio', speaker });
    expect(calls.some((c) => c.url.includes('/voice'))).toBe(false);
    expect(calls.filter((c) => c.url.endsWith('/script')).length).toBe(2);
    clearOwnVoice(cut.periodKey);
    await expect(submitCut(cut.id, { baseUrl: 'http://x', fetchImpl: f, voice: 'own', force: true })).rejects.toThrow(CutNotSubmittable);
  });

  it('records a refusal from the board and marks the cut failed', async () => {
    const cut = await preparedCut(25);
    const { submitCut } = await import('@/lib/jobs/submit');
    const { f } = board({ '/api/weeks/2026-W36/jobs': { status: 409, body: { ok: false, message: 'already has an export' } } });
    const out = await submitCut(cut.id, { baseUrl: 'http://x', fetchImpl: f });
    expect(out.cut.status).toBe('failed');
    expect(out.submissions.at(-1)).toMatchObject({ stage: null, error: 'already has an export' });
  });

  it('records a board that is down and marks the cut failed, without throwing', async () => {
    const cut = await preparedCut(25);
    const { submitCut } = await import('@/lib/jobs/submit');
    const { f } = board({ '/api/weeks/2026-W36/jobs': { fail: true } });
    const out = await submitCut(cut.id, { baseUrl: 'http://127.0.0.1:26100', fetchImpl: f });
    expect(out.cut.status).toBe('failed');
    expect(out.submissions.at(-1)?.error).toMatch(/not answering/);
  });
});

describe('the cut in the graph', () => {
  it('merges a Cut node linked to its week and pull', async () => {
    const { FakeGraph, FakeVectors, FakeEmbed } = await import('@/lib/knowledge/fake');
    const { useStoresForTests } = await import('@/lib/knowledge/stores');
    const graph = new FakeGraph();
    useStoresForTests({ graph, vectors: new FakeVectors(), embed: new FakeEmbed() });
    const { recordCut } = await import('@/lib/knowledge/spaces/jobs');
    await recordCut({ id: 3, periodKey: '2026-W36', kind: 'weekly', counted: 25, rejected: 0, status: 'planned' }, 1);
    expect(graph.node('Cut', { id: 3 })?.props).toMatchObject({ space: 'jobs', periodKey: '2026-W36', status: 'planned' });
    const edge = [...graph.edges.values()].find((e) => e.rel === 'FROM_POOL');
    expect(edge?.to).toContain('2026-W36');
    expect(edge?.props.pullId).toBe(1);
  });
});
