import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Family } from '@/lib/jobcard/schema';
import { panelJob, sparseJob } from './helpers/panelJob';

describe('a panel job as a card draft', () => {
  it('maps a full job: company, role, experience, place, pay, lists, rounds, dates, source and cta', async () => {
    const { jobToDraft } = await import('@/lib/jobcard/panelJob');
    const d = jobToDraft(panelJob());
    expect(d.company).toMatchObject({ name: 'Zoho Corporation' });
    expect(d.role).toMatchObject({ title: 'Software Development Engineer', skills: ['Java 17', 'Spring Boot', 'MySQL'] });
    expect(d.experience).toEqual({ label: '2 - 5 Years', min: 2, max: 5 });
    expect(d.location).toEqual({ city: 'Chennai', region: 'Tamil Nadu', workMode: 'hybrid' });
    expect(d.salary).toEqual({ min: 8, max: 18, currency: 'INR', unit: 'LPA', note: null });
    expect(d.eligibility).toEqual(['B.E. / B.Tech / MCA', 'No active backlogs']);
    expect(d.selectionProcess).toEqual([
      { step: 1, label: 'Online assessment', detail: null },
      { step: 2, label: 'Technical round 1', detail: 'DSA & fundamentals' },
      { step: 3, label: 'HR discussion', detail: null },
    ]);
    expect(d.dates).toEqual([{ kind: 'deadline', date: '12 December 2026', time: 'Registration closes 6 PM' }]);
    // The original listing is what the card cites; the family key marks it as a pool job.
    expect(d.source).toEqual({ url: 'https://careers.zohocorp.com/jobs/sde', kind: 'pool', poolId: null, familyKey: 'zoho|sde' });
    expect(d.cta).toEqual({ channel: 'site', url: 'https://aiiolar.com/jobs?job=zoho%7Csde', keyword: 'ZOHO' });
    expect(d.panel?.jobId).toBe('job_zoho_sde');
  });

  it('maps a sparse job without inventing anything: the gaps are named', async () => {
    const { jobToDraft } = await import('@/lib/jobcard/panelJob');
    const { missingMandatory } = await import('@/lib/jobcard/schema');
    const d = jobToDraft(sparseJob());
    expect(d.salary).toBeNull();
    expect(d.selectionProcess).toEqual([]);
    expect(d.dates).toEqual([]);
    // No original listing: the source is the post the job was found in, as a reference.
    expect(d.source).toMatchObject({ url: 'https://www.instagram.com/p/C1abc/', kind: 'reference' });
    expect(missingMandatory(d)).toEqual(['skill', 'eligibility']);
  });

  it('maps a remote job whose city is blank to the city "Remote"', async () => {
    const { jobToDraft } = await import('@/lib/jobcard/panelJob');
    const d = jobToDraft(panelJob({ city: '', region: null, workMode: 'remote' }));
    expect(d.location).toEqual({ city: 'Remote', region: null, workMode: 'remote' });
  });

  it('keeps a job with no salary as salary null, and the card still parses', async () => {
    const { jobToDraft } = await import('@/lib/jobcard/panelJob');
    const { parseJobCard } = await import('@/lib/jobcard/schema');
    const card = parseJobCard(jobToDraft(panelJob({ salary: null })));
    expect(card.salary).toBeNull();
  });

  it('uses the keyword the job carries, else the first word of the company', async () => {
    const { jobToDraft } = await import('@/lib/jobcard/panelJob');
    expect(jobToDraft(panelJob({ company: 'Tata Consultancy' })).cta?.keyword).toBe('TATA');
    const withKeyword = panelJob();
    withKeyword.attrs = { ...withKeyword.attrs, keyword: 'ZOHOJOBS' };
    expect(jobToDraft(withKeyword).cta?.keyword).toBe('ZOHOJOBS');
  });

  it('derives an experience label when the job has only numbers', async () => {
    const { jobToDraft } = await import('@/lib/jobcard/panelJob');
    expect(jobToDraft(panelJob({ experience: { min: 3, max: 6 } })).experience?.label).toBe('3 - 6 Years');
    expect(jobToDraft(panelJob({ experience: undefined })).experience?.label).toBeUndefined();
  });

  it('refuses a body that is not a panel job', async () => {
    const { PanelJobSchema } = await import('@/lib/jobcard/panelJob');
    expect(PanelJobSchema.safeParse({ company: 'x' }).success).toBe(false);
    expect(PanelJobSchema.safeParse(panelJob()).success).toBe(true);
  });
});

// ---- cards from jobs --------------------------------------------------------------------

/** A renderer that writes a stand-in PNG where the real one would, and says what it did. */
const fakeRender = (over: { fellBack?: boolean; fail?: Error } = {}) =>
  vi.fn(async (_card: unknown, family: Family, outPath: string) => {
    if (over.fail) throw over.fail;
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    return { family, file: outPath, width: 1080, height: 1440, overflowPx: 0, slackPx: 0, fellBack: over.fellBack ?? false };
  });

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-fromjob-'));
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  (await import('@/lib/db')).closeDb();
});

describe('a card from a panel job', () => {
  it('stores the card, renders it with the picker and answers with an absolute image url', async () => {
    const { cardFromJob } = await import('@/lib/jobcard/fromJob');
    const render = fakeRender();
    const out = await cardFromJob(panelJob(), { origin: 'http://studio.test:3120', renderer: render });
    // Five requirements and no logo to show: the picker's pick is the list-shaped family.
    expect(out).toMatchObject({ family: 'infographic', fellBack: false, missing: [] });
    expect(out.cardId).toContain('zoho');
    expect(out.imageUrl).toBe(`http://studio.test:3120/api/jobcards/${out.cardId}/image`);
    expect(render).toHaveBeenCalledTimes(1);

    const { getRow } = await import('@/lib/jobcard/store');
    expect(getRow(out.cardId)).toMatchObject({ company: 'Zoho Corporation', family: 'infographic', fellBack: false });
  });

  it('renders the family it is asked for', async () => {
    const { cardFromJob } = await import('@/lib/jobcard/fromJob');
    const render = fakeRender();
    const out = await cardFromJob(panelJob(), { origin: 'http://s', family: 'campaign', renderer: render });
    expect(render.mock.calls[0][1]).toBe('campaign');
    expect(out.family).toBe('campaign');
  });

  it('reports a fallback when the family could not hold the job', async () => {
    const { cardFromJob } = await import('@/lib/jobcard/fromJob');
    const out = await cardFromJob(panelJob(), { origin: 'http://s', family: 'campaign', renderer: fakeRender({ fellBack: true }) });
    expect(out.fellBack).toBe(true);
  });

  it('is idempotent per panel job: a repeat answers with the same card and does not render again', async () => {
    const { cardFromJob } = await import('@/lib/jobcard/fromJob');
    const render = fakeRender();
    const first = await cardFromJob(panelJob(), { origin: 'http://s', renderer: render });
    const again = await cardFromJob(panelJob(), { origin: 'http://s', renderer: render });
    expect(again.cardId).toBe(first.cardId);
    expect(again.imageUrl).toBe(first.imageUrl);
    expect(again.family).toBe(first.family);
    expect(render).toHaveBeenCalledTimes(1);
    const { listPage } = await import('@/lib/jobcard/store');
    expect(listPage().total).toBe(1);
  });

  it('re-renders the same card when the job changed, and keeps an earlier handoff', async () => {
    const { cardFromJob } = await import('@/lib/jobcard/fromJob');
    const store = await import('@/lib/jobcard/store');
    const render = fakeRender();
    const first = await cardFromJob(panelJob(), { origin: 'http://s', renderer: render });
    const draft = (await store.readDraft(first.cardId))!;
    await store.saveCard(first.cardId, { ...draft, handoff: { postId: 'p1', accountId: 'a1', at: '2026-11-26T00:00:00.000Z', status: 'queued' } });

    const changed = await cardFromJob(panelJob({ role: 'Senior Software Engineer' }), { origin: 'http://s', renderer: render });
    expect(changed.cardId).toBe(first.cardId);
    expect(render).toHaveBeenCalledTimes(2);
    const after = (await store.readDraft(first.cardId))!;
    expect(after.role?.title).toBe('Senior Software Engineer');
    expect(after.handoff).toMatchObject({ postId: 'p1' });
    expect(store.listPage().total).toBe(1);
  });

  it('renders an unrendered card on a repeat, and re-renders when another family is asked for', async () => {
    const { cardFromJob } = await import('@/lib/jobcard/fromJob');
    const render = fakeRender();
    const drafted = await cardFromJob(panelJob(), { origin: 'http://s', renderer: render, render: false });
    expect(drafted).toMatchObject({ imageUrl: null, family: null, missing: [] });
    expect(render).not.toHaveBeenCalled();

    const rendered = await cardFromJob(panelJob(), { origin: 'http://s', renderer: render });
    expect(rendered.cardId).toBe(drafted.cardId);
    expect(rendered.imageUrl).toBeTruthy();
    expect(render).toHaveBeenCalledTimes(1);

    await cardFromJob(panelJob(), { origin: 'http://s', renderer: render, family: 'campaign' });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('names what is missing and does not render a job with gaps', async () => {
    const { cardFromJob } = await import('@/lib/jobcard/fromJob');
    const render = fakeRender();
    const out = await cardFromJob(sparseJob(), { origin: 'http://s', renderer: render });
    expect(out.missing).toEqual(['skill', 'eligibility']);
    expect(out.imageUrl).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });
});

describe('cards for a carousel', () => {
  it('renders one card per job, in order, one at a time', async () => {
    const { cardsFromJobs } = await import('@/lib/jobcard/fromJob');
    let running = 0;
    let overlap = 0;
    const order: string[] = [];
    const base = fakeRender();
    const render = vi.fn(async (card: { company: { name: string } }, family: Family, outPath: string) => {
      running++;
      overlap = Math.max(overlap, running);
      order.push(card.company.name);
      await new Promise((r) => setTimeout(r, 5));
      const out = await base(card, family, outPath);
      running--;
      return out;
    });
    const jobs = [panelJob({ id: 'a', company: 'Alpha' }), panelJob({ id: 'b', company: 'Beta' }), panelJob({ id: 'c', company: 'Gamma' })];
    const out = await cardsFromJobs(jobs, { origin: 'http://s', renderer: render as never });
    expect(out.map((c) => c.panelJobId)).toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(overlap).toBe(1);
    expect(out.every((c) => c.imageUrl && c.missing.length === 0)).toBe(true);
  });

  it('reports a failed job on its own entry and carries on with the rest', async () => {
    const { cardsFromJobs } = await import('@/lib/jobcard/fromJob');
    const ok = fakeRender();
    const render = vi.fn(async (card: { company: { name: string } }, family: Family, outPath: string) => {
      if (card.company.name === 'Beta') throw new Error('chromium crashed');
      return ok(card, family, outPath);
    });
    const jobs = [panelJob({ id: 'a', company: 'Alpha' }), panelJob({ id: 'b', company: 'Beta' }), sparseJob({ id: 'c' })];
    const out = await cardsFromJobs(jobs, { origin: 'http://s', renderer: render as never });
    expect(out[0]).toMatchObject({ panelJobId: 'a', imageUrl: expect.any(String), missing: [] });
    expect(out[1]).toMatchObject({ panelJobId: 'b', imageUrl: null, error: expect.stringContaining('chromium crashed') });
    expect(out[2]).toMatchObject({ panelJobId: 'c', imageUrl: null, missing: ['skill', 'eligibility'] });
  });
});

describe('the real renderer on a panel job', () => {
  afterEach(async () => {
    await (await import('@/lib/jobcard/render')).closeBrowser();
  });

  it('renders a full job and a no-salary job to a PNG each, with nothing running off the card', async () => {
    const { cardFromJob } = await import('@/lib/jobcard/fromJob');
    const { imagePath, getRow } = await import('@/lib/jobcard/store');
    const { statSync } = await import('fs');
    for (const job of [panelJob(), panelJob({ id: 'job_nosalary', salary: null, workMode: 'remote', city: '' })]) {
      const out = await cardFromJob(job, { origin: 'http://s' });
      expect(out.missing).toEqual([]);
      expect(statSync(imagePath(out.cardId)).size).toBeGreaterThan(1000);
      expect(getRow(out.cardId)?.overflowPx).toBe(0);
    }
  }, 180_000);
});
