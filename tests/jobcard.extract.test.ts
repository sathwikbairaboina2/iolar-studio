import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fromJobPosting, fromPoolRow, fromUrl, jsonLdBlocks, postingText } from '@/lib/jobcard/extract';
import { missingMandatory } from '@/lib/jobcard/schema';
import type { ResearchJob } from '@/lib/jobs/researchApi';

const html = readFileSync(path.join(process.cwd(), 'tests/fixtures/jobpage.html'), 'utf8');
const page = async () => ({ html, url: 'https://careers.zohocorp.com/jobs/sde' });

/** What an applicant tracking system actually serves: a shell, with the posting in its markup. */
const shell = readFileSync(path.join(process.cwd(), 'tests/fixtures/jobpage-shell.html'), 'utf8');

/** The model, standing still: the same JSON a listing's prose would produce. */
const run = async () =>
  JSON.stringify({
    skills: ['Java 17', 'Spring Boot', 'MySQL'],
    eligibility: ['B.E. / B.Tech / MCA, 60% throughout', '2021–2024 pass-outs, no active backlogs'],
    selectionProcess: [
      { label: 'Online assessment', detail: 'Aptitude & coding' },
      { label: 'Technical round 1', detail: null },
      { label: 'HR discussion', detail: null },
    ],
    experienceLabel: '2 – 5 Years',
    team: 'Product Engineering',
    salaryNote: null,
  });

const poolRow: ResearchJob = {
  id: 412,
  sourceId: 3,
  sourceLabel: 'careers',
  provider: 'greenhouse',
  url: 'https://careers.zohocorp.com/jobs/sde',
  title: 'Software Development Engineer',
  company: 'Zoho Corporation',
  location: 'Chennai, Tamil Nadu',
  category: 'india',
  remote: false,
  employment: 'full-time',
  salary: '₹8L - ₹18L',
  tags: ['java'],
  description: 'Hybrid role. 2 - 5 years building backend services in Java and Spring Boot.',
  postedAt: '2026-09-01T00:00:00.000Z',
  isTech: true,
  firstSeenAt: '2026-09-01T00:00:00.000Z',
  lastSeenAt: '2026-09-03T00:00:00.000Z',
  closedAt: null,
  familyKey: 'zoho|sde',
  locationCount: 1,
  locations: ['Chennai, Tamil Nadu'],
};

describe('reading a listing', () => {
  it('takes the page at its word where the page publishes JobPosting markup', () => {
    const marked = fromJobPosting(jsonLdBlocks(html));
    expect(marked.company?.name).toBe('Zoho Corporation');
    expect(marked.role?.title).toBe('Software Development Engineer');
    expect(marked.location).toMatchObject({ city: 'Chennai', region: 'Tamil Nadu' });
    // A yearly rupee figure is said in lakhs on a card.
    expect(marked.salary).toMatchObject({ min: 8, max: 18, currency: 'INR', unit: 'LPA' });
    expect(marked.dates?.[0]).toMatchObject({ kind: 'deadline', date: '2026-09-12' });
  });

  it('reads the posting out of the markup when the page is a JavaScript shell', () => {
    const text = postingText(jsonLdBlocks(shell), shell);
    expect(text).toContain('CUDA and PTX kernels');
    expect(text).not.toContain('enable JavaScript');
  });

  it('hands the model the posting, not the shell', async () => {
    const seen: string[] = [];
    const spy = async (p: string) => {
      seen.push(p);
      return JSON.stringify({ skills: ['CUDA', 'Triton'], eligibility: ['5+ years in ML systems'] });
    };
    const { draft } = await fromUrl('https://jobs.example.com/x', {
      run: spy,
      page: async () => ({ html: shell, url: 'https://jobs.example.com/x' }),
    });
    expect(seen[0]).toContain('Nsight Compute');
    expect(draft.role?.skills).toEqual(['CUDA', 'Triton']);
  });

  it('resolves the mark against the page it came from', async () => {
    const { marks } = await fromUrl('https://careers.zohocorp.com/jobs/sde', { page });
    // Zoho's careers page is Zoho's own site, so its icons are Zoho's to take.
    expect(marks.map((m) => m.url)).toContain('https://careers.zohocorp.com/assets/zoho-mark.png');
  });

  it('reads a URL into a complete document with the model filling only prose', async () => {
    const { draft, marks } = await fromUrl('https://careers.zohocorp.com/jobs/sde', { run, page });
    expect(missingMandatory(draft)).toEqual([]);
    expect(draft.role?.skills).toContain('Spring Boot');
    expect(draft.eligibility).toHaveLength(2);
    expect(draft.selectionProcess?.map((s) => s.step)).toEqual([1, 2, 3]);
    expect(draft.experience?.label).toBe('2 – 5 Years');
    expect(draft.source).toMatchObject({ kind: 'job-url' });
    expect(marks.some((m) => m.url.includes('zoho-mark.png'))).toBe(true);
  });

  it('reads a URL without a model, and says what is still missing', async () => {
    const { draft } = await fromUrl('https://careers.zohocorp.com/jobs/sde', { page });
    expect(missingMandatory(draft)).toEqual(['skill', 'eligibility']);
    expect(draft.cta?.channel).toBe('site');
    expect(draft.cta?.url).toMatch(/^https:\/\/aiiolar\.com\/jobs\?q=Software%20Development%20Engineer%20Zoho/);
  });

  it('maps a pool row across and asks the model only for what the row cannot say', async () => {
    const draft = await fromPoolRow(poolRow, run);
    expect(draft.company?.name).toBe('Zoho Corporation');
    expect(draft.location).toMatchObject({ city: 'Chennai', workMode: 'hybrid' });
    expect(draft.salary).toMatchObject({ min: 8, max: 18, unit: 'LPA' });
    expect(draft.experience).toMatchObject({ min: 2, max: 5 });
    expect(draft.source).toMatchObject({ kind: 'pool', poolId: 412, familyKey: 'zoho|sde' });
    expect(draft.cta).toEqual({ channel: 'site', url: 'https://aiiolar.com/jobs?job=zoho%7Csde' });
    expect(missingMandatory(draft)).toEqual([]);
  });

  it('never invents a round the listing did not announce', async () => {
    const silent = async () => JSON.stringify({ skills: ['Java'], eligibility: ['B.E.'], selectionProcess: [] });
    const draft = await fromPoolRow(poolRow, silent);
    expect(draft.selectionProcess).toEqual([]);
  });
});
