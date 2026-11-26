import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { JobCard, parseJobCard } from '@/lib/jobcard/schema';
import { FALLBACK, pickFamily, scoreFamilies } from '@/lib/jobcard/pick';

const base = parseJobCard(
  JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/jobcard.json'), 'utf8'))
);

const withOut = (edit: (c: JobCard) => JobCard) => edit(JSON.parse(JSON.stringify(base)) as JobCard);

describe('picking a family', () => {
  it('sends a dense job to campaign, the family that holds a full document', () => {
    expect(base.role.skills.length + base.eligibility.length + base.selectionProcess.length + base.dates.length).toBeGreaterThanOrEqual(13);
    expect(pickFamily(base)).toBe('campaign');
    expect(FALLBACK).toBe('campaign');
  });

  it('sends a drive with dates and rounds to campaign', () => {
    const drive = withOut((c) => ({ ...c, dates: [{ kind: 'walk-in', date: '20 September 2026', time: '10 AM' }] }));
    expect(pickFamily(drive)).toBe('campaign');
  });

  it('sends several requirements and no dates to infographic', () => {
    const listing = withOut((c) => ({
      ...c,
      selectionProcess: [],
      dates: [],
      eligibility: ['B.E. / B.Tech, 60% throughout', 'No standing arrears'],
      role: { ...c.role, skills: ['Java', 'Spring Boot', 'SQL'] },
    }));
    expect(pickFamily(listing)).toBe('infographic');
  });

  it('ranks both families, always, so a pick can be overridden', () => {
    const scores = scoreFamilies(base);
    expect(scores.map((s) => s.family).sort()).toEqual(['campaign', 'infographic']);
    expect(scores[0].score).toBeGreaterThanOrEqual(scores[1].score);
  });
});

describe('a card with no salary', () => {
  it('scores every family without crashing and ranks the same as with a salary', () => {
    const none = withOut((c) => ({ ...c, salary: undefined }));
    expect(scoreFamilies(none).map((s) => s.family)).toEqual(scoreFamilies(base).map((s) => s.family));
    expect(pickFamily(none)).toBe(pickFamily(base));
  });
});
