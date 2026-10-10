import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '..', 'components', 'aiiolar-sheet');
const AIIOLAR = process.env.AIIOLAR_DIR || 'C:/Users/sathwik/projects/aiiolar';

type Source = { commit: string; files: Record<string, { from: string; sha256: string }> };
const source = (): Source => JSON.parse(readFileSync(path.join(DIR, 'SOURCE.json'), 'utf8'));

describe('aiiolar sheet copy', () => {
  it('has every file SOURCE.json lists', () => {
    const s = source();
    expect(Object.keys(s.files).length).toBeGreaterThan(10);
    for (const name of Object.keys(s.files)) expect(existsSync(path.join(DIR, name)), name).toBe(true);
  });

  it('matches the aiiolar checkout it was copied from', (ctx) => {
    if (!existsSync(AIIOLAR)) {
      console.warn('aiiolar checkout not found; run npm run sync:aiiolar-sheet after updating aiiolar');
      return ctx.skip();
    }
    const stale: string[] = [];
    for (const [name, f] of Object.entries(source().files)) {
      const p = path.join(AIIOLAR, f.from);
      const sha = existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'missing';
      if (sha !== f.sha256) stale.push(name);
    }
    expect(stale, 'aiiolar changed; run npm run sync:aiiolar-sheet').toEqual([]);
  });

  it('imports nothing from aiiolar paths', () => {
    for (const name of readdirSync(DIR).filter((n) => /\.(tsx?|css)$/.test(n))) {
      const text = readFileSync(path.join(DIR, name), 'utf8');
      expect(text, name).not.toMatch(/from '~\//);
      expect(text, name).not.toMatch(/@\/lib\/handbooks\//);
    }
  });
});
