import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import type { ResearchJob } from '@/lib/jobs/researchApi';

const sample = (JSON.parse(readFileSync('tests/fixtures/jobs-pool.sample.json', 'utf8')) as { items: ResearchJob[] }).items;
const byTitle = (s: string) => sample.find((j) => j.title.includes(s))!;

describe('function', () => {
  it('places common titles by rule and leaves the rest to the model', async () => {
    const { mapFunction } = await import('@/lib/jobs/map');
    expect(mapFunction('Data Engineer (India)')).toBe('data');
    expect(mapFunction('Software Dev Engineer II')).toBe('engineering');
    expect(mapFunction('Product Management - Senior Product Manager - Lending')).toBe('product');
    expect(mapFunction("COO's Office (Business Analyst)")).toBe('data');
    expect(mapFunction('Growth Lead')).toBe('marketing');
    expect(mapFunction('Technical Lead Manager', ['Engineering', 'Backend'])).toBe('engineering');
    expect(mapFunction('Founding Engineer')).toBe('engineering');
    expect(mapFunction('Mechanical Engineer (India)')).toBe('engineering');
    expect(mapFunction('Chief of Staff')).toBeNull();
  });
});

describe('experience', () => {
  it('reads a range from the description before it reads the title', async () => {
    const { mapExperience } = await import('@/lib/jobs/map');
    expect(mapExperience('Senior Engineer', 'You have 3-5 years of experience shipping.')).toEqual({ min: 3, max: 5 });
    expect(mapExperience('Engineer', '8+ years')).toEqual({ min: 8, max: 12 });
    expect(mapExperience('Senior Software Engineer - Full Stack', '')).toEqual({ min: 5, max: 9 });
    expect(mapExperience('Technical Lead Manager', '')).toEqual({ min: 8, max: 15 });
    expect(mapExperience('Software Dev Engineer II', '')).toEqual({ min: 5, max: 9 });
    expect(mapExperience('Product Specialist', '')).toEqual({ min: 2, max: 5 });
    expect(mapExperience('Engineering Intern', '')).toEqual({ min: 0, max: 1 });
  });
});

describe('work mode', () => {
  it('remote from the flag, hybrid from the words, onsite otherwise', async () => {
    const { mapWorkMode } = await import('@/lib/jobs/map');
    expect(mapWorkMode(true, 'Bengaluru', '')).toBe('remote');
    expect(mapWorkMode(false, 'Bengaluru (Hybrid)', '')).toBe('hybrid');
    expect(mapWorkMode(false, 'Pune', 'This is a hybrid role, three days in office.')).toBe('hybrid');
    expect(mapWorkMode(false, 'Chennai, India', '')).toBe('onsite');
  });
});

describe('salary', () => {
  it('parses rupee forms to annual rupees and refuses other currencies', async () => {
    const { mapSalaryInr } = await import('@/lib/jobs/map');
    expect(mapSalaryInr('₹1.5M - ₹4M INR')).toEqual({ min: 1_500_000, max: 4_000_000 });
    expect(mapSalaryInr('₹12L - ₹18L')).toEqual({ min: 1_200_000, max: 1_800_000 });
    expect(mapSalaryInr('12-18 LPA')).toEqual({ min: 1_200_000, max: 1_800_000 });
    expect(mapSalaryInr('INR 8,00,000')).toEqual({ min: 800_000, max: 800_000 });
    expect(mapSalaryInr('$40K - $120K')).toEqual({ min: null, max: null });
    expect(mapSalaryInr(null)).toEqual({ min: null, max: null });
  });
});

describe('location', () => {
  it('names a city once whatever the source called it', async () => {
    const { mapLocation } = await import('@/lib/jobs/map');
    const at = (location: string, remote = false) => mapLocation({ location, locations: [location], remote });
    expect(at('BENGALURU, Karnataka, India')).toBe('Bengaluru');
    expect(at('Bangalore, India')).toBe('Bengaluru');
    expect(at('Gurgaon, Haryana')).toBe('Gurugram');
    expect(at('Noida, Uttar Pradesh, India')).toBe('Noida');
    expect(at('Bengaluru (Hybrid), KA')).toBe('Bengaluru');
    expect(at('Remote', true)).toBe('Remote');
    expect(at('', true)).toBe('Remote');
  });
});

describe('a row', () => {
  it('maps a real listing into the reel schema with a stable id', async () => {
    const { mapRow } = await import('@/lib/jobs/map');
    const j = byTitle('Data Engineer (India)');
    const m = mapRow(j, '2026-W36', 'data');
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.row).toMatchObject({
      id: `${j.familyKey}|2026-W36`,
      company: 'Intelligence Factory',
      function: 'data',
      location: 'Pune',
      workMode: 'onsite',
      salaryMin: 1_500_000,
      salaryMax: 4_000_000,
      currency: 'INR',
      closesOn: null,
      link: j.url,
    });
    expect(m.row.postedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects a listing without a url, with the reason', async () => {
    const { mapRow } = await import('@/lib/jobs/map');
    const m = mapRow({ ...byTitle('Founding Engineer'), url: 'not a url' }, '2026-W36', 'engineering');
    expect(m).toEqual({ ok: false, reason: expect.stringMatching(/^link:/) });
  });
});

describe('a batch', () => {
  it('sends only the unruled titles to the classifier, once, and marks who decided', async () => {
    const { mapRows } = await import('@/lib/jobs/map');
    const jobs = [byTitle('Data Engineer (India)'), { ...byTitle('Product Specialist'), id: 999, title: 'Chief of Staff', familyKey: 'x|chief of staff' }];
    const classify = vi.fn(async (titles: string[]) => titles.map(() => 'operations'));
    const rows = await mapRows(jobs, '2026-W36', classify);
    expect(classify).toHaveBeenCalledOnce();
    expect(classify.mock.calls[0][0]).toEqual(['Chief of Staff']);
    expect(rows.map((r) => r.mappedBy)).toEqual(['rule', 'qwen']);
    expect((rows[1].row as { function: string }).function).toBe('operations');
  });

  it('falls back to other when the classifier fails or answers nonsense', async () => {
    const { mapRows, parseLabels } = await import('@/lib/jobs/map');
    const jobs = [{ ...byTitle('Product Specialist'), id: 999, title: 'Chief of Staff', familyKey: 'x|chief of staff' }];
    const rows = await mapRows(jobs, '2026-W36', async () => {
      throw new Error('qwen down');
    });
    expect((rows[0].row as { function: string }).function).toBe('other');
    expect(parseLabels('Sure! ["engineering", "banana"]', 2)).toEqual(['engineering', 'banana']);
    expect(parseLabels('no json here', 2)).toEqual([]);
  });
});
