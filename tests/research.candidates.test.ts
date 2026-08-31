import { describe, it, expect } from 'vitest';
import { withStableIds } from '@/lib/reel/research/candidate';
import { candidateId, canonicalizeUrl } from '@/lib/reel/research/url';

/**
 * Candidate ids are derived, not invented.
 *
 * The critic used to be asked for a 12-hex id per source. One malformed id in
 * eleven failed validation at the write and threw away thirteen minutes of
 * searching, so the ids now come from the canonical URL, which cannot be wrong.
 */

const base = (over: Record<string, unknown> = {}) => ({
  id: 'zzzz',
  sourceClass: 'github',
  url: 'https://github.com/Rust-for-Linux/linux',
  canonicalUrl: 'https://github.com/Rust-for-Linux/linux',
  title: 'Rust for Linux',
  publisher: 'github.com',
  author: null,
  publishedAt: null,
  retrievedAt: '2026-08-31T00:00:00.000Z',
  thumbnailUrl: null,
  durationSec: null,
  summary: 'the tree',
  pullQuotes: [],
  stats: [],
  assetKind: 'repo',
  clipWindow: null,
  whyItMatters: 'proves it is merged',
  scores: { relevance: 5, authority: 5, recency: 4, uniqueness: 5, usability: 4 },
  scoreTotal: 92,
  verdict: 'keep',
  rejectReason: null,
  dupeOf: null,
  hunterAgent: 'source-hunter',
  fetchPlan: { method: 'gh', target: 'https://github.com/Rust-for-Linux/linux', note: null },
  risk: { paywall: false, licence: null, unstable: false },
  ...over,
});

describe('withStableIds', () => {
  it('replaces whatever the model called it with the hash of the canonical URL', () => {
    const [c] = withStableIds([base()] as never);
    expect(c.id).toBe(candidateId(canonicalizeUrl('https://github.com/Rust-for-Linux/linux')));
    expect(c.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('rewrites dupeOf through the same remapping, so pointers still land', () => {
    const kept = base();
    const dupe = base({
      id: 'second-bad-id',
      url: 'https://lwn.net/Articles/1/',
      canonicalUrl: 'https://lwn.net/Articles/1/',
      dupeOf: 'zzzz',
    });
    const [a, b] = withStableIds([kept, dupe] as never);
    expect(b.dupeOf).toBe(a.id);
  });

  // Same source twice would collide on the hash, and two rows sharing an id is
  // a pointer that means nothing.
  it('keeps ids unique when two candidates share a canonical URL', () => {
    const [a, b] = withStableIds([base(), base({ id: 'other' })] as never);
    expect(a.id).not.toBe(b.id);
    expect(b.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('falls back to hashing the raw url when it will not parse', () => {
    const [c] = withStableIds([base({ canonicalUrl: 'not a url', url: 'not a url' })] as never);
    expect(c.id).toMatch(/^[0-9a-f]{12}$/);
  });
});
