import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';
import type { Finding } from '@/lib/verify/gates';

const post = (): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'S', date: 'd',
  slides: [
    { page_title: 'One', blocks: [
      { type: 'callout', style: 'cloud', title: 'Alias bombing', text: 'Depth limits miss it.' },
      { type: 'heading', text: 'Cost Limits' },
      { type: 'bullets', items: ['Score each field'] },
      { type: 'heading', text: 'Symptom → Cause' },
    ] },
    { page_title: 'Two', blocks: [{ type: 'table', headers: ['Symptom', 'Cause'], rows: [['x', 'y']] }] },
  ],
  caption: { text: '', hashtags: [] },
});

const finding = (over: Partial<Finding>): Finding => ({
  pass: 'pedagogy', rule: 'pedagogy.ai', severity: 'major', page: 1, summary: 's', evidence: 'e', fix: 'f', ...over,
});

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-moves-'));
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude' }));
  vi.resetModules();
});

describe('applyMoves', () => {
  it('reorders within a page and carries a block across pages', async () => {
    const { applyMoves } = await import('@/lib/ai/moves');
    const out = applyMoves(post(), [
      { from: { page: 1, block: 0 }, to: { page: 1, index: 2 }, expect: 'Alias bombing' },
      { from: { page: 1, block: 3 }, to: { page: 2, index: 0 }, expect: 'Symptom → Cause' },
    ]);
    expect(out.slides[0].blocks.map((b) => b.type)).toEqual(['heading', 'bullets', 'callout']);
    expect(out.slides[1].blocks.map((b) => b.type)).toEqual(['heading', 'table']);
  });

  it('refuses a move whose block is not the one the plan described', async () => {
    const { applyMoves } = await import('@/lib/ai/moves');
    expect(() => applyMoves(post(), [{ from: { page: 1, block: 1 }, to: { page: 2, index: 0 }, expect: 'Alias bombing' }]))
      .toThrow(/page 1 block 1/);
  });

  it('refuses a destination that does not exist, and leaves the input untouched', async () => {
    const { applyMoves } = await import('@/lib/ai/moves');
    const before = post();
    const snapshot = JSON.stringify(before);
    expect(() => applyMoves(before, [{ from: { page: 1, block: 0 }, to: { page: 3, index: 0 }, expect: 'Alias' }])).toThrow(/page 3/);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('strandedHeadingMove', () => {
  it('moves a stranded heading to the top of the next page without a model', async () => {
    const { strandedHeadingMove, applyMoves } = await import('@/lib/ai/moves');
    const p = post();
    const move = strandedHeadingMove(p, finding({ pass: 'code', rule: 'heading.stranded', page: 1, block: 3 }));
    expect(move).toEqual({ from: { page: 1, block: 3 }, to: { page: 2, index: 0 }, expect: 'Symptom → Cause' });
    expect(applyMoves(p, [move!]).slides[1].blocks[0]).toMatchObject({ type: 'heading', text: 'Symptom → Cause' });
  });

  it('returns null when the page no longer ends on that heading', async () => {
    const { strandedHeadingMove } = await import('@/lib/ai/moves');
    expect(strandedHeadingMove(post(), finding({ pass: 'code', rule: 'heading.stranded', page: 1, block: 1 }))).toBeNull();
  });
});

describe('proposeMoves', () => {
  it('turns a positional finding into a checked move plan', async () => {
    const plan = [{ from: { page: 1, block: 0 }, to: { page: 1, index: 2 }, expect: 'Alias bombing' }];
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(`Here is the plan:\n${JSON.stringify(plan)}`),
      ClaudeUnavailableError: class extends Error {},
    }));
    const { proposeMoves } = await import('@/lib/ai/moves');
    const out = await proposeMoves(post(), finding({ fix: 'Move the alias-bombing callout below the Cost Limits bullets.' }));
    expect(out.moves).toEqual(plan);
    expect(out.post.slides[0].blocks[2]).toMatchObject({ type: 'callout' });
  });
});

describe('isPositional', () => {
  it('recognises a finding whose fix is to move content', async () => {
    const { isPositional } = await import('@/lib/ai/moves');
    expect(isPositional(finding({ fix: 'Move this callout to page 2, just after the union definition.' }))).toBe(true);
    expect(isPositional(finding({ fix: 'Put the errgroup bullet first in the block.' }))).toBe(true);
    expect(isPositional(finding({ fix: 'Change the cell to "optional".' }))).toBe(false);
    expect(isPositional(finding({ pass: 'code', rule: 'heading.stranded' }))).toBe(true);
  });
});
