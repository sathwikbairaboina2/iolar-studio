import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { BriefInputSchema } from '@/lib/launch/schema';
import { createLaunch } from '@/lib/launch/store';
import { HfUnreachable } from '@/lib/launch/higgsfield';
import { readSpend, spent, withBudget } from '@/lib/launch/spend';

const hf = (cost = 40, balance = 1000) => {
  let bal = balance;
  return { cost: async () => cost, balance: async () => (bal -= cost) } as never;
};

let slug: string;
beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-spend-'));
  slug = await createLaunch({ title: 'Gemini 4', links: ['https://blog.google/x'], mode: 'avatar', creditBudget: 100 });
});

describe('withBudget', () => {
  it('generates the first two 40-credit clips and skips the third, recording why', async () => {
    const h = hf();
    const out: (string | null)[] = [];
    for (let i = 0; i < 3; i++) out.push(await withBudget(slug, h, `clip ${i}`, { kind: 'video' }, async () => `job-${i}`));
    expect(out).toEqual(['job-0', 'job-1', null]);
    const s = (await readSpend(slug))!;
    expect(s.budget).toBe(100);
    expect(s.entries.map((e) => e.outcome)).toEqual(['spent', 'spent', 'skipped-over-budget']);
    expect(s.entries[1]).toMatchObject({ what: 'clip 1', credits: 40, balanceAfter: 920 });
    expect(spent(s)).toBe(80);
  });

  it('records a submit that threw as unknown, counts it, and never retries', async () => {
    let tries = 0;
    const r = await withBudget(slug, hf(), 'clip', { kind: 'video' }, async () => { tries++; throw new Error('timeout'); });
    expect(r).toBeNull();
    expect(tries).toBe(1);
    const s = (await readSpend(slug))!;
    expect(s.entries[0].outcome).toBe('unknown');
    expect(spent(s)).toBe(40);
  });

  it('retries a failed cost preflight once, and records the error when it fails twice', async () => {
    let calls = 0;
    const flaky = { cost: async () => { calls++; if (calls === 1) throw new Error('no cost in reply'); return 15; }, balance: async () => 900 } as never;
    expect(await withBudget(slug, flaky, 'clip', {}, async () => 'j')).toBe('j');
    const broken = { cost: async () => { throw new Error('Higgsfield did not report a cost'); }, balance: async () => 0 } as never;
    expect(await withBudget(slug, broken, 'clip 2', {}, async () => 'x')).toBeNull();
    const e = (await readSpend(slug))!.entries[1];
    expect(e).toMatchObject({ outcome: 'failed', error: 'Higgsfield did not report a cost' });
  });

  it('records why a submit is unknown', async () => {
    await withBudget(slug, hf(), 'clip', {}, async () => { throw new Error('accepted but returned no job id'); });
    expect((await readSpend(slug))!.entries[0].error).toBe('accepted but returned no job id');
  });

  it('lets an unreachable Higgsfield through without spending or recording', async () => {
    const h = { cost: async () => { throw new HfUnreachable(); }, balance: async () => 0 } as never;
    await expect(withBudget(slug, h, 'clip', {}, async () => 'x')).rejects.toBeInstanceOf(HfUnreachable);
    expect(await readSpend(slug)).toBeNull();
  });

  it('keeps a balance that cannot be read as null', async () => {
    const h = { cost: async () => 5, balance: async () => { throw new Error('x'); } } as never;
    expect(await withBudget(slug, h, 'img', {}, async () => 'j')).toBe('j');
    expect((await readSpend(slug))!.entries[0].balanceAfter).toBeNull();
  });
});

describe('brief budget default', () => {
  it('is 120 for an avatar brief that gives none, 0 for faceless, and kept when given', () => {
    const base = { title: 'x', links: ['https://a.b/c'] };
    expect(BriefInputSchema.parse({ ...base, mode: 'avatar' }).creditBudget).toBe(120);
    expect(BriefInputSchema.parse(base).creditBudget).toBe(0);
    expect(BriefInputSchema.parse({ ...base, mode: 'avatar', creditBudget: 40 }).creditBudget).toBe(40);
  });
});
