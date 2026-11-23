import { describe, expect, it } from 'vitest';
import { applyUrlFor } from '@/lib/jobcard/cta';

const BASE = 'https://aiiolar.com/jobs';

describe('the apply link of a card', () => {
  it('opens the job itself for a card made from a pool row', () => {
    const card = {
      role: { title: 'SDE' },
      company: { name: 'Zoho' },
      source: { kind: 'pool' as const, familyKey: 'zoho|sde' },
    };
    expect(applyUrlFor(card, BASE)).toBe('https://aiiolar.com/jobs?job=zoho%7Csde');
  });

  it('searches the jobs page for every other card', () => {
    const card = { role: { title: 'Software Engineer I' }, company: { name: 'Zoho' }, source: { kind: 'reference' as const } };
    expect(applyUrlFor(card, BASE)).toBe('https://aiiolar.com/jobs?q=Software%20Engineer%20I%20Zoho');
    expect(applyUrlFor({ ...card, source: { kind: 'job-url' as const } }, BASE)).toBe(
      'https://aiiolar.com/jobs?q=Software%20Engineer%20I%20Zoho'
    );
  });

  it('searches when a pool card has no family key', () => {
    const card = { role: { title: 'SDE' }, company: { name: 'Zoho' }, source: { kind: 'pool' as const } };
    expect(applyUrlFor(card, BASE)).toBe('https://aiiolar.com/jobs?q=SDE%20Zoho');
  });

  it('encodes what would break a query string', () => {
    const card = { role: { title: 'R&D Engineer #2' }, company: { name: 'A/B Labs' }, source: { kind: 'job-url' as const } };
    expect(applyUrlFor(card, BASE)).toBe('https://aiiolar.com/jobs?q=R%26D%20Engineer%20%232%20A%2FB%20Labs');
  });

  it('trims the query and copes with a trailing slash on the base', () => {
    expect(applyUrlFor({ company: { name: 'Zoho' } }, 'https://aiiolar.com/jobs/')).toBe('https://aiiolar.com/jobs?q=Zoho');
    expect(
      applyUrlFor({ source: { kind: 'pool', familyKey: 'a|b' } }, 'https://aiiolar.com/jobs///')
    ).toBe('https://aiiolar.com/jobs?job=a%7Cb');
  });
});
