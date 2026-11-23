import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { JobCard, parseJobCard } from '@/lib/jobcard/schema';
import { pickFamily, scoreFamilies } from '@/lib/jobcard/pick';

const base = parseJobCard(
  JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/jobcard.json'), 'utf8'))
);

const withOut = (edit: (c: JobCard) => JobCard) => edit(JSON.parse(JSON.stringify(base)) as JobCard);

describe('picking a family', () => {
  it('sends a drive with dates and rounds to campaign', () => {
    const drive = withOut((c) => ({ ...c, dates: [{ kind: 'walk-in', date: '20 September 2026', time: '10 AM' }] }));
    expect(pickFamily(drive)).toBe('campaign');
  });

  it('sends a deadline with no drive to ticket', () => {
    const deadline = withOut((c) => ({
      ...c,
      selectionProcess: [],
      eligibility: ['B.E. / B.Tech, 60% throughout'],
      dates: [{ kind: 'deadline', date: '12 September 2026', time: null }],
    }));
    expect(pickFamily(deadline)).toBe('ticket');
  });

  it('sends a listing with a mark and few facts to split-hero', () => {
    const withLogo = withOut((c) => ({
      ...c,
      company: { ...c.company, logo: { src: 'data/jobcard/x/logo.png', kind: 'page' } },
      selectionProcess: [],
      dates: [],
      eligibility: ['B.E. / B.Tech, 60% throughout'],
      role: { ...c.role, skills: ['Java', 'Spring Boot'] },
    }));
    expect(pickFamily(withLogo)).toBe('split-hero');
  });

  it('ranks every family, always, so a pick can be overridden', () => {
    const scores = scoreFamilies(base);
    expect(scores).toHaveLength(6);
    expect(scores.map((s) => s.family)).toContain('band-stack');
    expect(scores[0].score).toBeGreaterThanOrEqual(scores[5].score);
  });
});

describe('a card with no salary', () => {
  it('scores every family without crashing and ranks the same as with a salary', () => {
    const none = withOut((c) => ({ ...c, salary: undefined }));
    expect(scoreFamilies(none).map((s) => s.family)).toEqual(scoreFamilies(base).map((s) => s.family));
    expect(pickFamily(none)).toBe(pickFamily(base));
  });
});
