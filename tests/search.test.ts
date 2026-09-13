import { describe, expect, it } from 'vitest';
import { PER_KIND, score, searchExplainers, searchReels } from '@/lib/search';

const explainer = (slug: string, title: string, theme = 'blueprint') => ({ slug, title, theme });
const reel = (slug: string, title: string) => ({ slug, title, style: 'armand', status: 'built' });

describe('how a hit is ranked', () => {
  it('rates exact above prefix above contains, and no match at all as zero', () => {
    expect(score('cdn', 'cdn')).toBe(3);
    expect(score('CDN Distance', 'cdn')).toBe(2);
    expect(score('What a CDN buys', 'cdn')).toBe(1);
    expect(score('Connection pools', 'cdn')).toBe(0);
  });

  it('ignores case and the spaces around what was typed', () => {
    expect(score('Connection Pools', '  connection  ')).toBe(2);
  });

  it('matches nothing on an empty query, so an empty box is not every row', () => {
    expect(score('anything', '   ')).toBe(0);
  });
});

describe('searching a shelf', () => {
  it('puts the closer title first, whatever order the rows arrived in', () => {
    const hits = searchExplainers(
      [explainer('a', 'What a CDN actually buys you'), explainer('b', 'CDN distance')],
      'cdn'
    );
    expect(hits.map((h) => h.label)).toEqual(['CDN distance', 'What a CDN actually buys you']);
  });

  it('finds a row by its slug and by its theme, not only its title', () => {
    expect(searchExplainers([explainer('why-an-index-changes-everything', 'Indexes')], 'index')).toHaveLength(1);
    expect(searchExplainers([explainer('a', 'Indexes', 'midnight')], 'midnight')).toHaveLength(1);
  });

  it('drops the rows that do not match at all', () => {
    expect(searchExplainers([explainer('a', 'Connection pools')], 'kafka')).toEqual([]);
  });

  it('caps one shelf so it cannot crowd out the others', () => {
    const many = Array.from({ length: PER_KIND + 4 }, (_, i) => reel(`r-${i}`, `Rate limits ${i}`));
    expect(searchReels(many, 'rate')).toHaveLength(PER_KIND);
  });

  it('links each kind at the route that opens it', () => {
    expect(searchExplainers([explainer('cdn', 'CDN')], 'cdn')[0].href).toBe('/explainers/cdn');
    expect(searchReels([reel('bitcoin-mining-power', 'Bitcoin')], 'bitcoin')[0].href).toBe('/reel/bitcoin-mining-power');
  });
});
