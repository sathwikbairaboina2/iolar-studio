import { describe, it, expect } from 'vitest';
import { tools } from '@/lib/reel/pattern/tools';
import { patternDef, PATTERNS } from '@/lib/reel/pattern';
import type { Script } from '@/lib/reel/research/script';

const line = (id: string, order: number, role: 'hook' | 'body' | 'close', text: string, citations: string[] = []) => ({
  id, order, role, text, citations, assetIds: citations, note: null, commentary: false,
});
export const script: Script = {
  runId: 'r', createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z', status: 'approved',
  lines: [
    line('l1', 0, 'hook', 'Three tools nobody told you about.'),
    line('l2', 1, 'body', 'The first runs offline.', ['aaaaaaaaaaaa']),
    line('l3', 2, 'body', 'The second costs nothing.', ['bbbbbbbbbbbb']),
    line('l4', 3, 'body', 'Here is the repo.', ['aaaaaaaaaaaa']),
    line('l5', 4, 'close', 'Comment tools and I will DM you the links.'),
  ],
  unsupported: [], coverage: [], flags: [],
};
export const candidates = {
  aaaaaaaaaaaa: { id: 'aaaaaaaaaaaa', url: 'https://github.com/a', title: 'A', thumbnailUrl: 'https://img/a.png' },
  bbbbbbbbbbbb: { id: 'bbbbbbbbbbbb', url: 'https://example.com/b', title: 'B', thumbnailUrl: null },
};
export const limits = { title: 60, chips: 3, chip: 16, points: 4, point: 40, keyword: 12, topic: 40, secMin: 1, secMax: 30 };
export const good = [
  { kind: 'hook', lineIds: ['l1'], title: '3 tools nobody told you about', chips: ['free', 'local'], tease: 'the third is wild' },
  { kind: 'slides', slides: [
    { lineIds: ['l2'], topic: 'Runs offline', points: ['zero telemetry'], image: 'https://img/a.png', stats: [] },
    { lineIds: ['l3'], topic: 'Costs nothing', points: ['MIT licence', 'no signup'], image: null, stats: [] },
  ] },
  { kind: 'web', pages: [{ lineIds: ['l4'], url: 'https://github.com/a', label: 'link 1/1' }] },
  { kind: 'cta', lineIds: ['l5'], keyword: 'TOOLS', line: 'we DM you every link', follow: 'more useful tech, weekly' },
];

describe('tools pattern: prompt', () => {
  it('names every line id, every candidate url, the limits and the themes', () => {
    const p = tools.prompt({ script, candidates, brand: { handle: '@iolar', name: 'iolar' }, limits, themes: ['kinetic'] });
    for (const l of script.lines) expect(p).toContain(`[${l.id}]`);
    expect(p).toContain('https://github.com/a');
    expect(p).toContain('60');
    expect(p).toContain('kinetic');
    expect(p).toMatch(/every line id exactly once/i);
  });
  it('quotes earlier errors when retrying', () => {
    const p = tools.prompt({ script, candidates, brand: { handle: '@iolar', name: 'iolar' }, limits, themes: [], errors: ['sections.0.title: 70 characters, the limit is 60'] });
    expect(p).toContain('the limit is 60');
  });
});

describe('tools pattern: units and checks', () => {
  it('lists units in template order with their lines', () => {
    expect(tools.units(good).map((u) => [u.kind, u.lineIds])).toEqual([
      ['hook', ['l1']], ['slide', ['l2']], ['slide', ['l3']], ['page', ['l4']], ['cta', ['l5']],
    ]);
    expect(tools.units(good).map((u) => u.path)).toEqual(['sections.0', 'sections.1.slides.0', 'sections.1.slides.1', 'sections.2.pages.0', 'sections.3']);
  });
  it('passes a good document', () => {
    expect(tools.check(good, script, candidates, limits)).toEqual([]);
  });
  it('rejects a missing line, a duplicated line, and lines out of order', () => {
    const missing = structuredClone(good);
    (missing[2] as { pages: { lineIds: string[] }[] }).pages[0].lineIds = [];
    expect(tools.check(missing, script, candidates, limits).map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/l4.*missing|missing.*l4/)])
    );
    const dup = structuredClone(good);
    (dup[3] as { lineIds: string[] }).lineIds = ['l4', 'l5'];
    expect(tools.check(dup, script, candidates, limits).some((e) => /l4.*twice|twice.*l4/.test(e.message))).toBe(true);
    const swapped = structuredClone(good);
    const s = swapped[1] as { slides: { lineIds: string[] }[] };
    s.slides[0].lineIds = ['l3'];
    s.slides[1].lineIds = ['l2'];
    expect(tools.check(swapped, script, candidates, limits).some((e) => /order/.test(e.message))).toBe(true);
  });
  it('rejects copy over the limits with the field path', () => {
    const long = structuredClone(good);
    (long[0] as { title: string }).title = 'x'.repeat(61);
    const errs = tools.check(long, script, candidates, limits);
    expect(errs[0]).toMatchObject({ path: 'sections.0.title' });
    expect(errs[0].message).toContain('60');
  });
  it('rejects a page url that is not one of the candidates', () => {
    const bad = structuredClone(good);
    (bad[2] as { pages: { url: string }[] }).pages[0].url = 'https://evil.example/';
    expect(tools.check(bad, script, candidates, limits)[0]).toMatchObject({ path: 'sections.2.pages.0.url' });
  });
  it('requires hook and cta and refuses a second hook', () => {
    expect(tools.check(good.slice(1), script, candidates, limits).some((e) => /hook/.test(e.message))).toBe(true);
    expect(tools.check([good[0], good[0], ...good.slice(1)], script, candidates, limits).some((e) => /once|twice/.test(e.message))).toBe(true);
  });
});

describe('tools pattern: parse', () => {
  it('reads the model output, fills defaults, and applies the checks', () => {
    const raw = 'Here you go:\n```json\n' + JSON.stringify({ sections: good }) + '\n```';
    const sections = tools.parse(raw, script, candidates, limits) as typeof good;
    expect(sections[1]).toMatchObject({ kind: 'slides' });
    expect(() => tools.parse(JSON.stringify({ sections: good.slice(1) }), script, candidates, limits)).toThrow(/hook/);
  });
});

describe('tools pattern: document', () => {
  const reel = { ratio: '9:16', fps: 30, pattern: { name: 'tools', theme: 'kinetic', presenter: 'lipsync', sections: good, job: null } } as never;
  const times = tools.units(good).map((u, i) => ({ ...u, start: i * 5, end: i * 5 + 5, sec: 5 }));

  it('produces the service shape with measured seconds and file urls only', () => {
    const doc = tools.doc({
      reel, script, sections: good, times, brand: { handle: '@iolar', name: 'iolar' }, captions: true,
      assets: { vo: 'file:///C:/r/vo.mp3', presenter: 'file:///C:/r/presenter.mp4', words: [{ w: 'three', start: 0, end: 0.3 }] },
    }) as { template: string; theme: string; sections: { kind: string; sec?: number; slides?: { sec: number }[]; pages?: { sec: number }[]; presenter?: string }[]; vo: { file: string; words: unknown[] }; captions: { enabled: boolean }; music: { file: null } };
    expect(doc.template).toBe('tools');
    expect(doc.theme).toBe('kinetic');
    expect(doc.sections.map((s) => s.kind)).toEqual(['hook', 'slides', 'web', 'cta']);
    expect(doc.sections[0]).toMatchObject({ sec: 5, presenter: 'file:///C:/r/presenter.mp4', title: '3 tools nobody told you about' });
    expect(doc.sections[1].slides!.map((s) => s.sec)).toEqual([5, 5]);
    expect(doc.sections[2].pages![0].sec).toBe(5);
    expect(doc.sections[3]).toMatchObject({ kind: 'cta', sec: 5, keyword: 'TOOLS' });
    expect(doc.vo).toEqual({ file: 'file:///C:/r/vo.mp3', words: [{ w: 'three', start: 0, end: 0.3 }] });
    expect(doc.captions.enabled).toBe(true);
    expect(doc.music.file).toBeNull();
    expect(JSON.stringify(doc)).not.toContain('lineIds');
  });

  it('omits vo when there is no voice yet and falls back to the fixture presenter', () => {
    const doc = tools.doc({ reel, script, sections: good, times, brand: { handle: '@iolar', name: 'iolar' }, captions: false, assets: { vo: null, presenter: null, words: [] } }) as { vo?: unknown; sections: { presenter?: string }[] };
    expect(doc.vo).toBeUndefined();
    expect(doc.sections[0].presenter).toBe('fixture://presenter.mp4');
  });
});

describe('registry', () => {
  it('knows tools and refuses the unknown', () => {
    expect(Object.keys(PATTERNS)).toEqual(['tools']);
    expect(patternDef('tools').name).toBe('tools');
    expect(() => patternDef('carousel')).toThrow(/unknown pattern/);
  });

  it('offers only patterns the service also lists', async () => {
    const { availablePatterns } = await import('@/lib/reel/pattern');
    const f = (async () => ({
      ok: true, status: 200,
      json: async () => ({ templates: [
        { name: 'tools', displayName: 'Tools', themes: ['kinetic'], limits, defaults: { hook: 10 }, sections: [], required: [], samples: {} },
        { name: 'carousel', displayName: 'C', themes: [], limits: {}, defaults: {}, sections: [], required: [], samples: {} },
      ] }),
    })) as unknown as typeof fetch;
    expect((await availablePatterns({ baseUrl: 'http://t1', fetchImpl: f })).map((p) => p.name)).toEqual(['tools']);
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await availablePatterns({ baseUrl: 'http://t2', fetchImpl: down })).toEqual([]);
  });
});
