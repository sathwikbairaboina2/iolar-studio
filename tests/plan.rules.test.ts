import { describe, it, expect } from 'vitest';
import { SCHEMA_RULES, RECIPE_GUIDANCE } from '@/lib/ai/plan';
import { DIAGRAM_KINDS, BULLET_STYLES, TEMPLATES } from '@/lib/schema';

describe('SCHEMA_RULES teaches the whole vocabulary', () => {
  it('names every diagram kind, list style and template', () => {
    for (const k of DIAGRAM_KINDS) expect(SCHEMA_RULES).toContain(`"${k}"`);
    for (const s of BULLET_STYLES) expect(SCHEMA_RULES).toContain(`"${s}"`);
    for (const t of TEMPLATES) expect(SCHEMA_RULES).toContain(`"${t}"`);
  });
  it('names every inline marker and the new fields', () => {
    for (const m of ['==', '**', '__', '`', '{green:']) expect(SCHEMA_RULES).toContain(m);
    for (const f of ['"frame"', '"note"', '"highlightRow"', '"sticky"', '"sticky-pink"', '"purple"', '"orange"']) expect(SCHEMA_RULES).toContain(f);
  });
  it('states the code line ceiling that keeps a snippet in a column', () => {
    expect(SCHEMA_RULES).toMatch(/34 characters/);
  });
  it('no longer offers removed diagram kinds', () => {
    for (const k of ['memory-cells', '"tree"', '"compare"']) expect(SCHEMA_RULES).not.toContain(k);
  });
  it('recipe guidance covers the pattern page and the revision sheet', () => {
    for (const w of ['dry run', 'revision sheet', 'flowchart', 'complexity']) expect(RECIPE_GUIDANCE.toLowerCase()).toContain(w);
  });
});
