import { promises as fs } from 'fs';
import path from 'path';
import { loadReel } from '../store';
import * as research from '../research/store';
import { getSettings } from '@/lib/settings';
import { reelDir, reelPresenterFile, reelVoFile } from '@/lib/paths';
import { textHash } from '../script';
import { patternDef, templateFor } from './index';
import { templates, type ServiceOpts } from '@/lib/templates/service';
import { defaultTimes, lineSpans, unitTimes } from './timing';
import { alignScriptWords } from '../script-align';
import type { Brand, CandidateRef, UnitTime } from './types';

/** The service reads every asset by URL; a local file is `file:///C:/...`, never a bare path. */
export function fileUrl(absPath: string): string {
  const p = path.resolve(absPath).replace(/\\/g, '/');
  return p.startsWith('/') ? `file://${p}` : `file:///${p}`;
}

export function docHash(doc: unknown): string {
  return textHash(JSON.stringify(doc));
}

const exists = (p: string) => fs.stat(p).then(() => true).catch(() => false);

export async function candidateRefs(slug: string): Promise<Record<string, CandidateRef>> {
  const file = await research.readCandidates(slug).catch(() => null);
  const list = file?.candidates ?? [];
  return Object.fromEntries(list.map((c) => [c.id, { id: c.id, url: c.url, title: c.title, thumbnailUrl: c.thumbnailUrl ?? null }]));
}

/** The brand the document carries; settings hold the name, the handle follows it unless set. */
export function brandFor(): Brand {
  const s = getSettings() as { brand: string; handle?: string };
  return { handle: s.handle ?? `@${s.brand}`, name: s.brand };
}

export type BuiltDocument = {
  doc: unknown;
  hash: string;
  times: UnitTime[];
  /** True when the seconds came from the aligned voice rather than the template defaults. */
  measured: boolean;
  /** Which clip fills the hook, or null when there is none yet. */
  presenter: 'upload' | 'lipsync' | null;
};

/**
 * The document the service renders from, built fresh from disk every time: sections,
 * the voice and its words, the presenter clip, the brand. Seconds are measured here from
 * the aligned words and never stored.
 */
export async function buildDocument(slug: string, opts: { captions?: boolean } & ServiceOpts = {}): Promise<BuiltDocument> {
  const reel = await loadReel(slug);
  if (!reel.pattern) throw new Error(`${slug} has no pattern; it is a freeform reel`);
  const def = patternDef(reel.pattern.name);
  const script = await research.readScript(slug);
  const template = templateFor(reel.pattern.name, await templates(opts));
  const units = def.units(reel.pattern.sections);

  const voFile = reelVoFile(slug);
  const hasVo = await exists(voFile);
  const words = reel.vo.words;
  const measured = hasVo && words.length > 0 && reel.vo.durationSec > 0;
  // The service owns the cut of a voiced reel (it fits the words itself); these local times
  // only feed the hook audio cut and the board's strip when the service cannot be asked, so
  // the hand-written cap on `sec` does not apply here.
  const times = measured
    ? unitTimes(units, lineSpans(script, words), reel.vo.durationSec, { fps: reel.fps, secMin: template.limits.secMin ?? 1, secMax: Number.POSITIVE_INFINITY })
    : defaultTimes(units, template.defaults, { fps: reel.fps });

  const uploaded = await exists(reelPresenterFile(slug));
  const hook = reel.pattern.sections.find((s) => (s as { kind?: string }).kind === 'hook') as { assetId?: string } | undefined;
  const lipsyncAsset = hook?.assetId ? reel.assets.find((a) => a.id === hook.assetId && a.status === 'ready') : undefined;
  const presenterPath = uploaded ? reelPresenterFile(slug) : lipsyncAsset ? path.join(reelDir(slug), lipsyncAsset.path) : null;

  // Captions are spelled by the script and timed by the recogniser: whisper's timings are
  // trusted, its spelling is not ("FIDO" comes back as anything). A word it never heard
  // borrows no timing and is left out.
  const lines = [...script.lines].sort((a, b) => a.order - b.order).map((l) => ({ id: l.id, text: l.text }));
  const spelled = words.length
    ? alignScriptWords(lines, words).filter((w) => typeof w.start === 'number' && typeof w.end === 'number').map((w) => ({ w: w.w, start: w.start, end: w.end }))
    : [];
  const doc = def.doc({
    reel, script, sections: reel.pattern.sections, times, brand: brandFor(),
    captions: opts.captions ?? true,
    assets: {
      vo: hasVo ? fileUrl(voFile) : null,
      presenter: presenterPath ? fileUrl(presenterPath) : null,
      words: spelled,
    },
  });
  return { doc, hash: docHash(doc), times, measured, presenter: uploaded ? 'upload' : lipsyncAsset ? 'lipsync' : null };
}
