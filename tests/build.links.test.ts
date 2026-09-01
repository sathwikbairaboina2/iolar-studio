import { describe, it, expect } from 'vitest';
import { resolveLink } from '@/lib/reel/build/links';
import { providerNameFor } from '@/lib/reel/videoProvider';

const cand = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  canonicalUrl: `https://example.com/${id}`,
  url: `https://example.com/${id}`,
  scoreTotal: 80,
  pullQuotes: [{ text: 'the phrase that proves it', context: '' }],
  ...over,
});
const script = (citations: string[]) => ({ lines: [{ id: 'l1', text: 'The claim as spoken.', citations }] });

describe('resolveLink', () => {
  it('sends a beat to the page its line cites, sweeping the pull quote', () => {
    const link = resolveLink(script(['c1']) as never, [cand('c1')] as never, 'l1');
    expect(link).toEqual({ url: 'https://example.com/c1', highlight: 'the phrase that proves it', candidateId: 'c1' });
  });

  // The critic already ranked these; ranking them again would be a second opinion.
  it('picks the strongest citation when a line has several', () => {
    const link = resolveLink(
      script(['c1', 'c2']) as never,
      [cand('c1', { scoreTotal: 70 }), cand('c2', { scoreTotal: 95 })] as never,
      'l1'
    );
    expect(link!.candidateId).toBe('c2');
  });

  it('sends no highlight when the source has no phrase to sweep', () => {
    const link = resolveLink(script(['c1']) as never, [cand('c1', { pullQuotes: [] })] as never, 'l1');
    // The marker sweeps words that are on the page. The narration is not on the page, so
    // sending it asked the plugin to find a sentence nobody had written there.
    expect(link!.highlight).toBeUndefined();
  });

  // A marker sweeps a phrase, not a paragraph.
  it('sends no highlight when the only quote is too long to sweep', () => {
    const long = 'x'.repeat(200);
    const link = resolveLink(script(['c1']) as never, [cand('c1', { pullQuotes: [{ text: long, context: '' }] })] as never, 'l1');
    // The marker sweeps words that are on the page. The narration is not on the page, so
    // sending it asked the plugin to find a sentence nobody had written there.
    expect(link!.highlight).toBeUndefined();
  });

  // A page visit with no source is exactly the fabrication the research prevents.
  it('resolves nothing for a line that cites nothing', () => {
    expect(resolveLink(script([]) as never, [cand('c1')] as never, 'l1')).toBeNull();
  });

  it('resolves nothing for a beat with no line behind it', () => {
    expect(resolveLink(script(['c1']) as never, [cand('c1')] as never, null)).toBeNull();
  });

  it('ignores a citation whose candidate is gone from the pack', () => {
    expect(resolveLink(script(['missing']) as never, [cand('c1')] as never, 'l1')).toBeNull();
  });
});

describe('providerNameFor', () => {
  it('routes screen to the pages renderer and talking-head to lipsync', () => {
    expect(providerNameFor('screen')).toBe('webpage');
    expect(providerNameFor('talking-head')).toBe('lipsync');
  });

  // A title is drawn by the pattern over whatever is behind it. It is not missing.
  it('routes a title nowhere', () => {
    expect(providerNameFor('title')).toBeNull();
  });
});
