import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { INKS, TEMPLATES } from '@/lib/schema';

const dir = path.join(process.cwd(), 'templates');
const templateDirs = readdirSync(dir).filter((d) => !d.startsWith('_'));

describe('template contract', () => {
  it('every schema template has a directory and vice versa', () => {
    expect([...templateDirs].sort()).toEqual([...TEMPLATES].sort());
  });

  it.each(templateDirs)('%s has required markers, scripts and manifest', (t) => {
    const html = readFileSync(path.join(dir, t, 'template.html'), 'utf8');
    expect(html).toContain('<!--CONTENT-->');
    expect(html).toContain('<!--PAGEVARS-->');
    expect(html).toContain('<!--HEAD-->');
    expect(html).toContain('<div id="page">');
    expect(html).toContain('../_shared/diagrams.js');
    const m = JSON.parse(readFileSync(path.join(dir, t, 'manifest.json'), 'utf8'));
    expect(m.name).toBe(t);
    expect(m.contentSelector).toBeTruthy();
    for (const ink of INKS) expect(m.inks[ink], `${t} missing ink ${ink}`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  it('shared assets exist', () => {
    for (const f of ['base.css', 'jitter.js', 'rough.min.js', 'fonts.css', 'pack.js', 'layout.js', 'diagrams.js'])
      expect(existsSync(path.join(dir, '_shared', f))).toBe(true);
  });

  it('base.css styles every new class', () => {
    const css = readFileSync(path.join(dir, '_shared', 'base.css'), 'utf8');
    for (const cls of ['.hl', '.em', '.ul', '.mono', '.bl-number', '.bl-check', '.bl-cross', '.b-frame', '.co-sticky', '.co-sticky-pink', '.code-note', '.code-small', '.tk-kw', '.tk-cm', '.tk-str', '.tk-num', '.tk-fn', '.hl-row', '.dg-array', '.ar-cell', '.ar-hl', '.ar-dim', '.dg-flowchart', '.fc-node', '.fc-diamond', '.fc-edges', '.dg-matrix', '.mx-hl', '.dg-cards', '.card', '.dg-node-rich', '--ink-purple', '--ink-orange', '--ink-pink', '.ic', '.bl-checkbox', '.bl-star'])
      expect(css, `base.css lacks ${cls}`).toContain(cls);
  });
});
