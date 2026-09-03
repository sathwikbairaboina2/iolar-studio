import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import type { VideoProvider } from '@/lib/reel/videoProvider';
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

/** What the service answers for GET /templates in every pattern test. */
export const templatesReply = {
  templates: [{
    name: 'tools', displayName: 'Tools', sections: ['hook', 'slides', 'web', 'cta'], required: ['hook', 'cta'],
    defaults: { hook: 10, slide: 6, page: 4, cta: 5 }, limits, themes: ['kinetic', 'glass-bento'], samples: {},
  }],
};

export const fetchTemplates = (async (url: string) => {
  if (String(url).endsWith('/templates')) return { ok: true, status: 200, json: async () => templatesReply } as Response;
  return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as Response;
}) as unknown as typeof fetch;

/** A full candidate the research schema accepts, from the short form the pattern tests use. */
export function candidateFixture(c: { id: string; url: string; title: string; thumbnailUrl: string | null }) {
  return {
    id: c.id, sourceClass: 'docs', url: c.url, canonicalUrl: c.url, title: c.title, publisher: 'p', author: null,
    publishedAt: null, retrievedAt: '2026-09-03T00:00:00.000Z', thumbnailUrl: c.thumbnailUrl, durationSec: null,
    summary: 'a source', pullQuotes: [], stats: [], assetKind: 'doc', clipWindow: null, whyItMatters: 'it proves the line',
    scores: { relevance: 5, authority: 5, recency: 5, uniqueness: 5, usability: 5 }, scoreTotal: 100, verdict: 'keep',
    rejectReason: null, dupeOf: null, hunterAgent: 'test', fetchPlan: { method: 'http', target: c.url, note: null },
    risk: { paywall: false, licence: null, unstable: false },
  };
}

/** Words for the whole script, one every 0.4 s from t=0.5, a breath between lines. */
export function heardWords() {
  const words: { w: string; start: number; end: number }[] = [];
  let t = 0.5;
  for (const l of [...script.lines].sort((a, b) => a.order - b.order)) {
    for (const w of l.text.split(/\s+/)) {
      words.push({ w, start: t, end: t + 0.3 });
      t += 0.4;
    }
    t += 0.4;
  }
  return words;
}

/**
 * Reel `t` as a pattern reel at a chosen point: script (approved unless said otherwise),
 * candidates, optionally sections, a voice file, and aligned words with a 20 s take.
 */
export async function seedPatternReel(opts: { sections?: boolean; voice?: boolean; words?: boolean; approved?: boolean } = {}) {
  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  const { writeScript, writeCandidates } = await import('@/lib/reel/research/store');
  const { reelDir, reelVoFile } = await import('@/lib/paths');
  const { promises: fsp } = await import('fs');
  await fsp.rm(reelDir('t'), { recursive: true, force: true });
  await createReel('t', { pattern: { name: 'tools', theme: 'kinetic', sections: opts.sections ? good : [] } } as never);
  mkdirSync(path.join(reelDir('t'), 'research'), { recursive: true });
  await writeScript('t', { ...script, status: opts.approved === false ? 'draft' : 'approved' });
  await writeCandidates('t', {
    runId: 't', generatedAt: '2026-09-03T00:00:00.000Z', criticVersion: 'test',
    stats: { perClass: {}, totalFound: 2, totalKept: 2, dupesCollapsed: 0 },
    candidates: Object.values(candidates).map(candidateFixture),
  } as never);
  if (opts.sections) {
    const { sectionsHash } = await import('@/lib/reel/pattern/section');
    const reel = await loadReel('t');
    await saveReel('t', { ...reel, pattern: { ...reel.pattern!, scriptHash: sectionsHash(script) } });
  }
  if (opts.voice || opts.words) writeFileSync(reelVoFile('t'), 'mp3');
  if (opts.words) {
    const reel = await loadReel('t');
    await saveReel('t', { ...reel, vo: { ...reel.vo, durationSec: 20, words: heardWords() } });
  }
  return loadReel('t');
}

export const fakeProvider = (states: string[] = ['running', 'ready']): VideoProvider & { animated: unknown[] } => {
  const p = {
    name: 'lipsync',
    animated: [] as unknown[],
    async available() { return true; },
    async animate(req: unknown) { p.animated.push(req); return { jobId: 'L1' }; },
    async jobState() { return (states.shift() ?? 'ready') as 'running' | 'ready'; },
    async collect(_id: string, dest: string) { writeFileSync(dest, 'clip'); },
  };
  return p;
};
