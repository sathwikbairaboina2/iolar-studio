import { promises as fs } from 'fs';
import path from 'path';
import { patternDir, patternsRoot } from '../paths';
import { Pattern, PatternMeta, validatePattern } from './pattern-schema';

/** Server-side pattern loading. The shape, and anything a browser needs, is in
 *  `pattern-schema.ts` — importing this module from a client component pulls in `fs`. */

export type { Pattern, PatternMeta } from './pattern-schema';
export { validatePattern, patternCssVars } from './pattern-schema';

export async function loadPattern(name: string): Promise<Pattern> {
  const file = path.join(patternDir(name), 'pattern.json');
  return validatePattern(JSON.parse(await fs.readFile(file, 'utf8')));
}

export async function listPatterns(): Promise<PatternMeta[]> {
  let dirs: string[] = [];
  try {
    dirs = (await fs.readdir(patternsRoot(), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: PatternMeta[] = [];
  for (const name of dirs) {
    try {
      const p = await loadPattern(name);
      out.push({ name: p.name, displayName: p.displayName, draft: name.endsWith('-draft') });
    } catch {
      // A malformed pattern dir is skipped, not fatal.
    }
  }
  return out;
}

export function patternCss(name: string): Promise<string> {
  return fs.readFile(path.join(patternDir(name), 'caption.css'), 'utf8');
}

export async function patternHookHtml(name: string): Promise<string> {
  try {
    return await fs.readFile(path.join(patternDir(name), 'hook.html'), 'utf8');
  } catch {
    return '<div class="reel-hook-title">{{logo}}{{title}}</div>';
  }
}
