import { describe, it, expect } from 'vitest';
import { SCHEMA_RULES, RECIPE_GUIDANCE, familyRecipe } from '@/lib/ai/plan';
import { PRESERVE_RULE, SCHEMA_RULES as RULES2 } from '@/lib/ai/rules';
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
  it('teaches icons, hero, subtitle, cover and the new list styles', () => {
    for (const w of ['{icon:', '"hero"', '"subtitle"', '"cover"', '"checkbox"', '"star"', '"pink"', 'IconName', '"chain"', '"tables"', '"schema"', '"er"', '"icon"']) expect(SCHEMA_RULES).toContain(w);
    expect(SCHEMA_RULES).toContain('"ec2"');
    expect(SCHEMA_RULES).toContain('"docker"');
  });
  it('recipe guidance covers the service page and the theory page', () => {
    for (const w of ['cover slide', 'key concepts', 'service diagram', 'schema', 'cloud']) expect(RECIPE_GUIDANCE.toLowerCase()).toContain(w);
  });
  it('recipe guidance covers the pattern page and the revision sheet', () => {
    for (const w of ['dry run', 'revision sheet', 'flowchart', 'complexity']) expect(RECIPE_GUIDANCE.toLowerCase()).toContain(w);
  });
});

describe('shared rules module', () => {
  it('plan re-exports the same rules the other stages import', () => {
    expect(RULES2).toBe(SCHEMA_RULES);
    for (const f of ['"hero"', '"icon"', '"frame"', '{icon:name}']) expect(PRESERVE_RULE).toContain(f);
  });
});

describe('family recipes', () => {
  it('every template tells the planner how its pages are shaped', () => {
    for (const t of TEMPLATES) {
      const r = familyRecipe(t);
      expect(r, t).toContain(`FAMILY "${t}"`);
      expect(r.length, t).toBeGreaterThan(80);
    }
    expect(familyRecipe('sketchnote')).toMatch(/hero/);
    expect(familyRecipe('marker-notes')).toMatch(/schema/);
    expect(familyRecipe('no-such-family')).toBe('');
  });
});
