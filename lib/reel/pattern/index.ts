import { tools } from './tools';
import { templates, ServiceDown, type ServiceOpts, type TemplateInfo } from '@/lib/templates/service';
import type { PatternDef } from './types';

export const PATTERNS: Record<string, PatternDef> = { tools };

export function patternDef(name: string): PatternDef {
  const def = PATTERNS[name];
  if (!def) throw new Error(`unknown pattern "${name}"; the studio knows ${Object.keys(PATTERNS).join(', ')}`);
  return def;
}

export type AvailablePattern = Pick<TemplateInfo, 'name' | 'displayName' | 'themes' | 'limits' | 'defaults'>;

/**
 * Patterns the studio can offer: known here AND rendered by the service. A template the
 * service does not list is not offered; a service that is down offers nothing.
 */
export async function availablePatterns(opts: ServiceOpts = {}): Promise<AvailablePattern[]> {
  let list: TemplateInfo[];
  try {
    list = await templates(opts);
  } catch (err) {
    if (err instanceof ServiceDown) return [];
    throw err;
  }
  return list.filter((t) => PATTERNS[t.name]).map(({ name, displayName, themes, limits, defaults }) => ({ name, displayName, themes, limits, defaults }));
}

/** The service's word for a pattern's limits and defaults, for callers that already have the list. */
export function templateFor(name: string, list: TemplateInfo[]): TemplateInfo {
  const t = list.find((x) => x.name === name);
  if (!t) throw new ServiceDown(`reels-templates does not list a "${name}" template`);
  return t;
}

export type { PatternDef, Unit, UnitTime, Limits, Brand, CandidateRef, PromptInput, DocInput } from './types';
export { SectionError } from './types';
