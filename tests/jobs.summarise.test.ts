import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { summarise } from '@/lib/jobs/summarise';
import type { JobsFile } from '@/lib/jobs/reelSchema';

/**
 * The studio's tiles must be the plugin's tiles. The fixture is the plugin's own week
 * 2026-W46: its jobs.json in, its summary.json out, highlights aside.
 */
const jobs = JSON.parse(readFileSync('tests/fixtures/jobs-reel-2026-W46/jobs.json', 'utf8')) as JobsFile;
const expected = JSON.parse(readFileSync('tests/fixtures/jobs-reel-2026-W46/summary.json', 'utf8')) as Record<string, unknown>;

describe('summarise', () => {
  it('reproduces the plugin summary for its own week, tile for tile', () => {
    const out = summarise(jobs, new Date(String(expected.generatedAt)));
    const { highlights: _h, ...want } = expected;
    void _h;
    expect(out).toEqual(want);
  });

  it('is empty but well formed for no jobs', () => {
    const out = summarise({ week: '2026-W37', jobs: [], rejected: [] }, new Date('2026-09-07T00:00:00.000Z'));
    expect(out).toMatchObject({ counted: 0, salaryCoverage: 0, byFunction: [], topCities: [], closingSoon: { within7Days: 0, nextDeadline: null } });
    expect(out.byExperience.map((b) => b.count)).toEqual([0, 0, 0, 0]);
  });
});
