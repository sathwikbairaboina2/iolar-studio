import { describe, it, expect } from 'vitest';
import { leadingRun, type FlowItem } from '@/lib/renderer/capture';

const item = (from: number, id: string): FlowItem =>
  ({ block: { type: 'bullets', items: [id] }, from } as FlowItem);

describe('leadingRun', () => {
  it('is empty for an empty queue', () => {
    expect(leadingRun([])).toEqual([]);
  });

  it('returns the whole queue when every block has one source', () => {
    const q = [item(0, 'a'), item(0, 'b'), item(0, 'c')];
    expect(leadingRun(q)).toHaveLength(3);
  });

  it('stops at the first block from a different authored slide', () => {
    // This is the defect: page 1 would otherwise end with chapter 1's opening blocks.
    const q = [item(0, 'a'), item(0, 'b'), item(1, 'c'), item(1, 'd')];
    const run = leadingRun(q);
    expect(run).toHaveLength(2);
    expect(run.every((x) => x.from === 0)).toBe(true);
  });

  it('does not rejoin a later run from the same slide', () => {
    // from 0,1,0 — the trailing 0 belongs to a separate run and must not be pulled forward.
    const q = [item(0, 'a'), item(1, 'b'), item(0, 'c')];
    expect(leadingRun(q)).toHaveLength(1);
  });

  it('keeps a single-block chapter as its own run', () => {
    const q = [item(3, 'only'), item(4, 'next')];
    const run = leadingRun(q);
    expect(run).toHaveLength(1);
    expect(run[0].from).toBe(3);
  });
});
