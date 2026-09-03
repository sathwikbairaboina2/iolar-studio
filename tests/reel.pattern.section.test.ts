import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { seedPatternReel, fetchTemplates } from './helpers/pattern';
import { script, good } from './reel.pattern.tools.test';

const opts = { baseUrl: 'http://x', fetchImpl: fetchTemplates };

describe('sectionReel', () => {
  beforeEach(() => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'sec-'));
    vi.resetModules();
  });

  it('asks once, stores the sections and the script hash', async () => {
    await seedPatternReel({});
    const { sectionReel, sectionsHash } = await import('@/lib/reel/pattern/section');
    const prompts: string[] = [];
    const ask = async (p: string) => {
      prompts.push(p);
      return JSON.stringify({ sections: good });
    };
    const reel = await sectionReel('t', { ...opts, ask });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('[l1]');
    expect(reel.pattern?.sections).toHaveLength(4);
    expect(reel.pattern?.scriptHash).toBe(sectionsHash(script));
  });

  it('retries once with the complaint quoted, then keeps the good answer', async () => {
    await seedPatternReel({});
    const { sectionReel } = await import('@/lib/reel/pattern/section');
    const bad = structuredClone(good);
    (bad[0] as { title: string }).title = 'x'.repeat(70);
    const prompts: string[] = [];
    const ask = async (p: string) => {
      prompts.push(p);
      return JSON.stringify({ sections: prompts.length === 1 ? bad : good });
    };
    const reel = await sectionReel('t', { ...opts, ask });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/sections\.0\.title.*60/);
    expect((reel.pattern?.sections[0] as { title: string }).title).toBe('3 tools nobody told you about');
  });

  it('gives up after the second bad answer and leaves the reel as it was', async () => {
    await seedPatternReel({});
    const { sectionReel } = await import('@/lib/reel/pattern/section');
    const { loadReel } = await import('@/lib/reel/store');
    const bad = structuredClone(good);
    (bad[3] as { lineIds: string[] }).lineIds = [];
    const ask = async () => JSON.stringify({ sections: bad });
    await expect(sectionReel('t', { ...opts, ask })).rejects.toMatchObject({ name: 'SectionError' });
    expect((await loadReel('t')).pattern?.sections).toEqual([]);
  });

  it('refuses a script that is not approved', async () => {
    await seedPatternReel({ approved: false });
    const { sectionReel } = await import('@/lib/reel/pattern/section');
    await expect(sectionReel('t', { ...opts, ask: async () => '' })).rejects.toThrow(/approved/);
  });
});
