import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fromScrapedPost } from '@/lib/jobcard/extract';
import { missingMandatory } from '@/lib/jobcard/schema';
import type { ScrapedItem } from '@/lib/jobcard/scraped';

const captions = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/scraped-captions.json'), 'utf8')
) as string[];

const item = (i: number, caption = captions[i]): ScrapedItem => ({
  shortcode: `hiring.daily.mock-${i}`,
  username: 'hiring.daily.mock',
  igUrl: `https://instagram.com/p/hiring.daily.mock-${i}/`,
  caption,
  status: 'selected',
  addedAt: '2026-11-23T08:00:00Z',
  thumbUrl: 'http://x/api/media/a/thumb',
});

describe('fromScrapedPost', () => {
  it('reads the labelled lines of the first caption', async () => {
    const d = await fromScrapedPost(item(0));
    expect(d.company?.name).toBe('Zoho');
    expect(d.role).toMatchObject({ title: 'Software Engineer I', skills: ['Java', 'SQL', 'Data structures'] });
    expect(d.experience).toMatchObject({ min: 0, max: 2, label: '0 – 2 Years' });
    expect(d.location).toMatchObject({ city: 'Chennai', region: 'India', workMode: 'onsite' });
    expect(d.eligibility).toEqual(['B.E/B.Tech 2024 or 2025 graduates']);
    expect(d.salary).toMatchObject({ min: 6, max: 9, currency: 'INR', unit: 'LPA' });
    expect(d.source).toEqual({ url: 'https://instagram.com/p/hiring.daily.mock-0/', kind: 'reference', poolId: null });
    expect(d.cta).toEqual({ channel: 'whatsapp' });
    expect(missingMandatory(d)).toEqual([]);
  });

  it('gives the other two captions everything but a salary', async () => {
    for (const i of [1, 2]) {
      const d = await fromScrapedPost(item(i));
      expect(d.company?.name).toBeTruthy();
      expect(d.role?.title).toBeTruthy();
      expect(d.role?.skills?.length).toBeGreaterThan(0);
      expect(d.experience?.label).toBeTruthy();
      expect(d.location?.city).toBeTruthy();
      expect(d.eligibility?.length).toBe(1);
      expect(d.salary).toBeUndefined();
      expect(missingMandatory(d)).toEqual(['salary range']);
    }
    const remote = await fromScrapedPost(item(1));
    expect(remote.location).toMatchObject({ city: 'Remote', workMode: 'remote' });
    expect(remote.company?.name).toBe('Freshworks');
    expect(remote.experience).toMatchObject({ min: 1, max: 3 });
  });

  it('accepts any case, Role/Position for the title, and invents nothing', async () => {
    const d = await fromScrapedPost(
      item(0, 'POSITION: Backend Dev\ncompany - Acme\nEXPERIENCE: fresher\nnothing useful here')
    );
    expect(d.role?.title).toBe('Backend Dev');
    expect(d.company?.name).toBe('Acme');
    // No range in the words, so the label is the post's own and no numbers are guessed.
    expect(d.experience).toMatchObject({ min: null, max: null, label: 'fresher' });
    expect(d.location).toBeUndefined();
    expect(d.eligibility).toBeUndefined();
    expect(d.salary).toBeUndefined();
  });

  it('asks the model only to fill gaps, and keeps what the rules read', async () => {
    const run = async () =>
      JSON.stringify({
        skills: ['Rust'],
        eligibility: ['model rule'],
        selectionProcess: [{ label: 'Online test', detail: null }],
        team: 'Platform',
      });
    const d = await fromScrapedPost(item(0), run);
    expect(d.role?.skills).toEqual(['Java', 'SQL', 'Data structures']);
    expect(d.eligibility).toEqual(['B.E/B.Tech 2024 or 2025 graduates']);
    expect(d.role?.team).toBe('Platform');
    expect(d.selectionProcess).toEqual([{ step: 1, label: 'Online test', detail: null }]);
  });

  it('does not throw when the model does', async () => {
    const run = async () => {
      throw new Error('ollama down');
    };
    const d = await fromScrapedPost(item(0), run);
    expect(d.company?.name).toBe('Zoho');
    expect(d.selectionProcess).toBeUndefined();
  });
});
