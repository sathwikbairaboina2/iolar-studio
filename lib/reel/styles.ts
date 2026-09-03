import { promises as fs } from 'fs';
import path from 'path';
import { styleDir, stylesRoot } from '../paths';
import { Style, StyleMeta, validateStyle } from './style-schema';

/** Server-side style loading. The shape, and anything a browser needs, is in
 *  `style-schema.ts` — importing this module from a client component pulls in `fs`. */

export type { Style, StyleMeta } from './style-schema';
export { validateStyle, styleCssVars } from './style-schema';

export async function loadStyle(name: string): Promise<Style> {
  const file = path.join(styleDir(name), 'style.json');
  return validateStyle(JSON.parse(await fs.readFile(file, 'utf8')));
}

export async function listStyles(): Promise<StyleMeta[]> {
  let dirs: string[] = [];
  try {
    dirs = (await fs.readdir(stylesRoot(), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: StyleMeta[] = [];
  for (const name of dirs) {
    try {
      const p = await loadStyle(name);
      out.push({ name: p.name, displayName: p.displayName, draft: name.endsWith('-draft') });
    } catch {
      // A malformed style dir is skipped, not fatal.
    }
  }
  return out;
}

export function styleCss(name: string): Promise<string> {
  return fs.readFile(path.join(styleDir(name), 'caption.css'), 'utf8');
}

export async function styleHookHtml(name: string): Promise<string> {
  try {
    return await fs.readFile(path.join(styleDir(name), 'hook.html'), 'utf8');
  } catch {
    return '<div class="reel-hook-title">{{logo}}{{title}}</div>';
  }
}
