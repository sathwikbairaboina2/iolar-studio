import { describe, it, expect, vi } from 'vitest';
import { judgeCoverage } from '@/lib/reel/research/agents';
import { unsupportedFromCoverage, unsupportedClaims } from '@/lib/reel/research/script';

/**
 * Coverage is a reading question.
 *
 * Every case here is taken from a live run where the keyword matcher reported a
 * claim unproven that the script stated outright.
 */

const line = (id: string, text: string, over: Record<string, unknown> = {}) => ({
  id,
  role: 'body',
  text,
  citations: ['a1b2c3d4e5f6'],
  commentary: false,
  ...over,
});

const capture = (reply: string) => {
  const seen: { prompt: string }[] = [];
  const run = vi.fn(async (prompt: string) => {
    seen.push({ prompt });
    return reply;
  });
  return { run, seen };
};

describe('judgeCoverage', () => {
  const CLAIM = 'The maximum fine the Act sets, as a figure and a percentage of turnover';
  const LINE = line('l1', 'Article 99 sets the ceiling: thirty-five million euros, or seven percent of turnover.');

  it('counts a claim proved in the script’s own words, which keyword overlap missed', async () => {
    const { run } = capture(JSON.stringify({ coverage: [{ claim: CLAIM, lineIds: ['l1'], why: 'states both' }] }));
    const [got] = await judgeCoverage([CLAIM], [LINE] as never, run);

    expect(got.lineIds).toEqual(['l1']);
    // The matcher it replaces gets this wrong, which is why the judge exists.
    expect(unsupportedClaims([CLAIM], [LINE] as never)).toEqual([CLAIM]);
  });

  it('shows the judge every cited line, and skips commentary', async () => {
    const { run, seen } = capture('{"coverage":[]}');
    await judgeCoverage(
      [CLAIM],
      [LINE, line('l2', 'My own view.', { commentary: true, citations: [] })] as never,
      run
    );

    expect(seen[0].prompt).toContain('[l1]');
    expect(seen[0].prompt).not.toContain('[l2]');
  });

  it('answers for every claim even when the model skips one', async () => {
    const { run } = capture(JSON.stringify({ coverage: [{ claim: CLAIM, lineIds: ['l1'], why: 'yes' }] }));
    const got = await judgeCoverage([CLAIM, 'A second thing entirely'], [LINE] as never, run);

    expect(got).toHaveLength(2);
    expect(got[1].lineIds).toEqual([]);
  });

  // An id the model made up is not a citation, and would keep a claim alive that
  // nothing states.
  it('drops line ids that are not in the script', async () => {
    const { run } = capture(JSON.stringify({ coverage: [{ claim: CLAIM, lineIds: ['nope'], why: 'x' }] }));
    const [got] = await judgeCoverage([CLAIM], [LINE] as never, run);

    expect(got.lineIds).toEqual([]);
  });

  it('reports every claim uncovered when no line is both factual and cited', async () => {
    const { run } = capture('{"coverage":[]}');
    const got = await judgeCoverage([CLAIM], [line('l1', 'hi', { commentary: true, citations: [] })] as never, run);

    expect(got[0].lineIds).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('unsupportedFromCoverage', () => {
  const CLAIM = 'A named Rust driver merged into mainline, with its kernel version';
  const coverage = [{ claim: CLAIM, lineIds: ['l1', 'l2'], why: 'both carry it' }];

  it('keeps a claim covered while any line that stated it survives', () => {
    const lines = [line('l2', 'Nova landed in 6.15.')];
    expect(unsupportedFromCoverage([CLAIM], coverage, lines as never)).toEqual([]);
  });

  it('reports the claim once every line that stated it is gone', () => {
    expect(unsupportedFromCoverage([CLAIM], coverage, [line('l9', 'unrelated')] as never)).toEqual([CLAIM]);
  });

  // Marking a line commentary is how a user says "this is me talking", which
  // means it is no longer evidence for anything.
  it('stops counting a line that has been marked commentary', () => {
    const lines = [line('l1', 'x', { commentary: true }), line('l2', 'y', { commentary: true })];
    expect(unsupportedFromCoverage([CLAIM], coverage, lines as never)).toEqual([CLAIM]);
  });

  it('reports a claim the judge never answered for', () => {
    expect(unsupportedFromCoverage(['unjudged'], coverage, [line('l1', 'x')] as never)).toEqual(['unjudged']);
  });
});
