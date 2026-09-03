import { describe, it, expect } from 'vitest';
import { tools } from '@/lib/reel/pattern/tools';
import { patternDef, PATTERNS } from '@/lib/reel/pattern';

import { script, candidates, limits, good } from './helpers/pattern';

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
    }) as { template: string; theme: string; sections: { kind: string; sec?: number; speech?: string; slides?: { sec?: number; speech?: string; points: unknown[] }[]; pages?: { sec?: number; speech?: string }[]; presenter?: string }[]; vo: { file: string; words: unknown[] }; captions: { enabled: boolean }; music: { file: null } };
    expect(doc.template).toBe('tools');
    expect(doc.theme).toBe('kinetic');
    expect(doc.sections.map((s) => s.kind)).toEqual(['hook', 'slides', 'web', 'cta']);
    // Voiced: the service cuts every unit to its words, so speech travels and no sec does.
    expect(doc.sections[0]).toMatchObject({ speech: 'Three tools nobody told you about.', presenter: 'file:///C:/r/presenter.mp4', title: '3 tools nobody told you about' });
    expect(doc.sections[0].sec).toBeUndefined();
    expect(doc.sections[1].slides!.map((s) => s.speech)).toEqual(['The first runs offline.', 'The second costs nothing.']);
    expect(doc.sections[1].slides![0].points).toEqual(['zero telemetry']);
    expect(doc.sections[2].pages![0].speech).toBe('Here is the repo.');
    expect(doc.sections[3]).toMatchObject({ kind: 'cta', speech: 'Comment tools and I will DM you the links.', keyword: 'TOOLS' });
    expect(doc.vo).toEqual({ file: 'file:///C:/r/vo.mp3', words: [{ w: 'three', start: 0, end: 0.3 }] });
    expect(doc.captions.enabled).toBe(true);
    expect(doc.music.file).toBeNull();
    expect(JSON.stringify(doc)).not.toContain('lineIds');
  });

  it('omits vo when there is no voice yet, sends the measured seconds instead of speech, and falls back to the fixture presenter', () => {
    const doc = tools.doc({ reel, script, sections: good, times, brand: { handle: '@iolar', name: 'iolar' }, captions: false, assets: { vo: null, presenter: null, words: [] } }) as { vo?: unknown; sections: { sec?: number; speech?: string; presenter?: string }[] };
    expect(doc.vo).toBeUndefined();
    expect(doc.sections[0].presenter).toBe('fixture://presenter.mp4');
    expect(doc.sections[0].sec).toBe(5);
    expect(doc.sections[0].speech).toBeUndefined();
  });

  it('sends a point with its anchor when the sections carry one, and reads anchored points from the model', () => {
    const anchored = structuredClone(good);
    (anchored[1] as { slides: { anchors?: (string | null)[] }[] }).slides[0].anchors = ['runs offline'];
    const doc = tools.doc({ reel, script, sections: anchored, times, brand: { handle: '@iolar', name: 'iolar' }, captions: true, assets: { vo: 'file:///C:/r/vo.mp3', presenter: null, words: [{ w: 'x', start: 0, end: 1 }] } }) as { sections: { slides?: { points: unknown[] }[] }[] };
    expect(doc.sections[1].slides![0].points).toEqual([{ text: 'zero telemetry', anchor: 'runs offline' }]);
    const raw = structuredClone(good);
    (raw[1] as { slides: { points: unknown[] }[] }).slides[1].points = [{ text: 'MIT licence', anchor: 'costs nothing' }, 'no signup'];
    const parsed = tools.parse(JSON.stringify({ sections: raw }), script, candidates, limits) as { slides: { points: string[]; anchors: (string | null)[] }[] }[];
    expect(parsed[1].slides[1].points).toEqual(['MIT licence', 'no signup']);
    expect(parsed[1].slides[1].anchors).toEqual(['costs nothing', null]);
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
