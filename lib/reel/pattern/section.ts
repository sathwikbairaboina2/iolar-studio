import { thinker } from '@/lib/ai/runner';
import { loadReel, saveReel } from '../store';
import * as research from '../research/store';
import type { Script } from '../research/script';
import type { Reel } from '../schema';
import { linesText, textHash } from '../script';
import { patternDef, templateFor } from './index';
import { templates, type ServiceOpts } from '@/lib/templates/service';
import { brandFor, candidateRefs } from './document';
import { SectionError } from './types';

/**
 * SECTION: the approved script becomes the pattern's sections. One model call, checked
 * against the invariant and the service's limits; one retry with the complaint quoted;
 * then the complaint is the answer. The reel is only written on success.
 */

export type SectionDeps = { ask?: (prompt: string) => Promise<string> } & ServiceOpts;

/** The fingerprint sections carry, so an edited script shows as "sections are stale". */
export function sectionsHash(script: Script): string {
  return textHash(linesText(script));
}

export async function sectionReel(slug: string, deps: SectionDeps = {}): Promise<Reel> {
  const reel = await loadReel(slug);
  if (!reel.pattern) throw new Error(`${slug} has no pattern; it is a freeform reel`);
  const script = await research.readScript(slug);
  if (script.status !== 'approved') throw new Error('the script is not approved yet — sections are cut from words you have signed off');

  const def = patternDef(reel.pattern.name);
  const template = templateFor(reel.pattern.name, await templates(deps));
  const candidates = await candidateRefs(slug);
  const ask = deps.ask ?? ((p: string) => thinker()(p, { timeoutMs: 600_000 }));

  const input = { script, candidates, brand: brandFor(), limits: template.limits, themes: template.themes };
  let sections: unknown[];
  try {
    sections = def.parse(await ask(def.prompt(input)), script, candidates, template.limits);
  } catch (first) {
    if (!(first instanceof SectionError)) throw first;
    const errors = [`${first.path}: ${first.message}`];
    sections = def.parse(await ask(def.prompt({ ...input, errors })), script, candidates, template.limits);
  }

  const next: Reel = { ...reel, pattern: { ...reel.pattern, sections: sections as Record<string, unknown>[], scriptHash: sectionsHash(script) } };
  await saveReel(slug, next);
  return next;
}
