import { describe, expect, it } from 'vitest';
import { ago, search } from '@/lib/explainer/browse';
import type { ExplainerSummary } from '@/lib/explainer/store';

const row = (over: Partial<ExplainerSummary> = {}): ExplainerSummary => ({
  slug: 'what-a-cdn-actually-buys-you',
  title: 'The CDN Distance Problem',
  theme: 'blueprint',
  beats: 5,
  nodes: 5,
  seconds: 14,
  updatedAt: '2026-09-11T16:21:13.221Z',
  renderedAt: '2026-09-11T16:21:30.882Z',
  poster: true,
  ...over,
});

describe('how long ago something happened', () => {
  const now = new Date('2026-09-12T12:00:00.000Z').getTime();
  const at = (secs: number) => new Date(now - secs * 1000).toISOString();

  it('counts in the largest unit that still reads as a number', () => {
    expect(ago(at(20), now)).toBe('20s ago');
    expect(ago(at(90), now)).toBe('2m ago');
    expect(ago(at(7200), now)).toBe('2h ago');
    expect(ago(at(172800), now)).toBe('2d ago');
  });

  it('says just now rather than 0s ago', () => {
    expect(ago(at(0), now)).toBe('just now');
  });

  it('never counts backwards from a clock that is ahead', () => {
    expect(ago(at(-500), now)).toBe('just now');
  });

  it('answers never for something that has not happened', () => {
    expect(ago(null, now)).toBe('never');
  });
});

describe('searching the shelf', () => {
  const rows = [
    row({ slug: 'a', title: 'The CDN Distance Problem', theme: 'blueprint' }),
    row({ slug: 'b', title: 'The Noisy Neighbor Problem', theme: 'midnight' }),
    row({ slug: 'c', title: 'Connection Pools', theme: 'blueprint' }),
  ];

  it('returns everything when nothing was typed', () => {
    expect(search(rows, '   ')).toHaveLength(3);
  });

  it('matches a title without caring about case', () => {
    expect(search(rows, 'noisy').map((r) => r.slug)).toEqual(['b']);
  });

  it('matches the theme too, because that is how you find the dark ones', () => {
    expect(search(rows, 'midnight').map((r) => r.slug)).toEqual(['b']);
  });

  it('matches the slug, so a pasted url finds its explainer', () => {
    expect(search(rows, 'connection-pools').map((r) => r.slug)).toEqual([]);
    expect(search([row({ slug: 'connection-pools', title: 'Pools' })], 'connection-pools')).toHaveLength(1);
  });

  it('finds nothing rather than everything when there is no match', () => {
    expect(search(rows, 'kubernetes')).toEqual([]);
  });
});
