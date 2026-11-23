import { describe, it, expect } from 'vitest';
import {
  JobCardSchema,
  FAMILIES,
  MANDATORY,
  missingMandatory,
  parseJobCard,
  ratioFor,
  type JobCard,
} from '@/lib/jobcard/schema';

const whole = (): JobCard =>
  parseJobCard({
    company: { name: 'Zoho Corporation' },
    role: { title: 'Software Development Engineer', skills: ['Java', 'Spring Boot', 'MySQL'] },
    experience: { min: 2, max: 5, label: '2 – 5 Years' },
    location: { city: 'Chennai', region: 'Tamil Nadu', workMode: 'hybrid' },
    salary: { min: 8, max: 18, currency: 'INR', unit: 'LPA' },
    eligibility: ['B.E. / B.Tech / MCA', '60% throughout, no active backlogs'],
    source: { url: 'https://careers.zohocorp.com/jobs/1', kind: 'job-url' },
  });

describe('the job card document', () => {
  it('fills the defaults a card needs and the source did not say', () => {
    const card = whole();
    expect(card.cta.keyword).toBe('ZOHO');
    expect(card.cta.channel).toBe('site');
    expect(card.cta.url).toBeUndefined();
    expect(card.selectionProcess).toEqual([]);
    expect(card.dates).toEqual([]);
  });

  it('keeps a stored channel and takes a site link', () => {
    expect(parseJobCard({ ...whole(), cta: { channel: 'whatsapp' } }).cta.channel).toBe('whatsapp');
    const site = parseJobCard({ ...whole(), cta: { channel: 'site', url: 'https://aiiolar.com/jobs?q=zoho' } });
    expect(site.cta).toMatchObject({ channel: 'site', url: 'https://aiiolar.com/jobs?q=zoho' });
    expect(parseJobCard({ ...whole(), source: { url: 'x', kind: 'pool', poolId: 1, familyKey: 'zoho|sde' } }).source.familyKey).toBe('zoho|sde');
  });

  it('takes the comment keyword the writer chose over the company name', () => {
    const card = parseJobCard({ ...whole(), cta: { keyword: 'chennai' } });
    expect(card.cta.keyword).toBe('CHENNAI');
  });

  it('refuses a salary whose floor is above its ceiling', () => {
    expect(() => parseJobCard({ ...whole(), salary: { min: 18, max: 8, currency: 'INR', unit: 'LPA' } })).toThrow();
  });

  it('parses a card with no salary and leaves it unset', () => {
    const { salary: _drop, ...rest } = whole();
    void _drop;
    const card = parseJobCard(rest);
    expect(card.salary).toBeUndefined();
    expect(missingMandatory(card)).toEqual([]);
    expect(MANDATORY.map((m) => m.label)).not.toContain('salary range');
    expect(parseJobCard({ ...rest, salary: null }).salary).toBeNull();
  });

  it('names every mandatory field a draft is still missing', () => {
    const draft = { company: { name: 'Zoho' }, role: { title: 'SDE', skills: [] } };
    const missing = missingMandatory(draft);
    expect(missing).toContain('skill');
    expect(missing).toContain('experience');
    expect(missing).toContain('location');
    expect(missing).not.toContain('salary range');
    expect(missing).toContain('eligibility');
    expect(missing).not.toContain('company');
  });

  it('holds nothing against a whole document', () => {
    expect(missingMandatory(whole())).toEqual([]);
  });

  it('does not count the selection process as missing — it is shown when the source has it', () => {
    expect(MANDATORY.map((m) => m.label)).not.toContain('selection process');
    expect(missingMandatory(whole())).toEqual([]);
  });

  it('knows the ratio each family renders at', () => {
    expect(FAMILIES).toEqual(['split-hero', 'infographic', 'campaign', 'bento', 'ticket', 'band-stack']);
    expect(ratioFor('infographic')).toEqual([1080, 1350]);
    expect(ratioFor('bento')).toEqual([1080, 1350]);
    expect(ratioFor('ticket')).toEqual([1080, 1440]);
    expect(ratioFor('band-stack')).toEqual([1080, 1440]);
  });
});
