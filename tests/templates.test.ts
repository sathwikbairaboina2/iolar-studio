import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'templates');
const templateDirs = readdirSync(dir).filter((d) => !d.startsWith('_'));

describe('template contract', () => {
  it.each(templateDirs)('%s has required markers and manifest', (t) => {
    const html = readFileSync(path.join(dir, t, 'template.html'), 'utf8');
    expect(html).toContain('<!--CONTENT-->');
    expect(html).toContain('<!--PAGEVARS-->');
    expect(html).toContain('<!--HEAD-->');
    const m = JSON.parse(readFileSync(path.join(dir, t, 'manifest.json'), 'utf8'));
    expect(m.name).toBe(t);
    expect(m.contentSelector).toBeTruthy();
    expect(m.inks).toBeTruthy();
  });

  it('shared assets exist', () => {
    for (const f of ['base.css', 'jitter.js', 'rough.min.js', 'fonts.css'])
      expect(existsSync(path.join(dir, '_shared', f))).toBe(true);
  });
});
