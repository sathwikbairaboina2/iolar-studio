import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { FAMILIES, parseJobCard, type Family, type JobCard } from '@/lib/jobcard/schema';
import { buildCardHtml } from '@/lib/jobcard/build';
import { renderFamily, closeBrowser } from '@/lib/jobcard/render';

const full = parseJobCard(
  JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/jobcard.json'), 'utf8'))
);

const sparse = (skills: string[] = ['Node.js', 'SQL'], over: Partial<Record<string, unknown>> = {}) =>
  parseJobCard({
    company: { name: 'Acme Labs', logo: null },
    role: { title: 'Backend Developer', skills },
    experience: { min: 1, max: 3, label: '1 – 3 Years' },
    location: { city: 'Pune', region: null, workMode: 'onsite' },
    eligibility: ['Any graduate'],
    selectionProcess: [],
    dates: [],
    cta: { channel: 'site' },
    source: { url: 'https://acme.example/jobs/1', kind: 'job-url', poolId: null },
    ...over,
  });

const withCta = (c: JobCard, cta: Partial<JobCard['cta']>): JobCard => ({ ...c, cta: { ...c.cta, ...cta } });
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const HOW = 'How to apply';

afterAll(async () => {
  await closeBrowser();
});

describe('how to apply', () => {
  it.each(FAMILIES)('%s lists comment, DM link and apply, in that order, for a card with no rounds', (family) => {
    const html = buildCardHtml(sparse(), family);
    expect(html).toContain(HOW);
    const a = html.indexOf('Comment &ldquo;ACME&rdquo;');
    const b = html.search(/Get the link in (your DMs|DM)/);
    const c = html.search(/Apply on (aiiolar\.com)/);
    expect(a, 'comment step').toBeGreaterThan(-1);
    expect(b, 'dm step').toBeGreaterThan(a);
    expect(c, 'apply step').toBeGreaterThan(b);
  });

  it.each(FAMILIES)('%s has no How to apply block when the job has rounds', (family) => {
    expect(buildCardHtml(full, family)).not.toContain(HOW);
  });

  it.each(FAMILIES)('%s words the whatsapp, bio and dm channels', (family) => {
    expect(buildCardHtml(withCta(sparse(), { channel: 'whatsapp' }), family)).toContain('Open our WhatsApp channel');
    expect(buildCardHtml(withCta(sparse(), { channel: 'bio' }), family)).toContain('Tap the link in our bio');
    expect(buildCardHtml(withCta(sparse(), { channel: 'dm' }), family)).toContain('Send us a DM');
  });

  it.each(FAMILIES)('%s drops the comment and DM steps when there is no keyword', (family) => {
    const html = buildCardHtml(withCta(sparse(), { keyword: '' }), family);
    expect(html).toContain(HOW);
    expect(html).not.toMatch(/Get the link in (your DMs|DM)/);
    expect(html).not.toContain('Comment &ldquo;&rdquo;');
    expect(html).toContain('Apply on aiiolar.com');
  });

  it('campaign names the deadline in the apply step when there is one', () => {
    const c = sparse(['Node.js'], { dates: [{ kind: 'deadline', date: '12 September 2026', time: null }] });
    expect(buildCardHtml(c, 'campaign')).toContain('before 12 September 2026');
    expect(buildCardHtml(sparse(), 'campaign')).toContain('the full listing is there');
  });
});

describe('campaign without rounds', () => {
  it('lists the skills once, inside Who can apply, with no "What the role asks" panel', () => {
    const html = buildCardHtml(sparse(), 'campaign');
    expect(html).not.toContain('What the role asks');
    expect(count(html, '>Node.js<'), 'Node.js').toBe(1);
    expect(count(html, '>SQL<'), 'SQL').toBe(1);
    const who = html.slice(html.indexOf('Who can apply'), html.indexOf(HOW));
    expect(who).toContain('Node.js');
    expect(who).toContain('SQL');
    expect(who.indexOf('Any graduate')).toBeLessThan(who.indexOf('Node.js'));
  });

  it('the two panels carry row counts that differ by at most one', () => {
    for (const c of [sparse(), sparse(['Node.js'])]) {
      const html = buildCardHtml(c, 'campaign');
      const [, , left, , right] = html.split(/<div class="panel( alt)?">/);
      const rows = (s: string) => count(s, 'class="erow"');
      expect(Math.abs(rows(left) - rows(right))).toBeLessThanOrEqual(1);
    }
  });

  it('caps Who can apply at four rows, eligibility first', () => {
    const c = sparse(['A1', 'B2', 'C3', 'D4'], { eligibility: ['E1', 'E2', 'E3'] });
    const html = buildCardHtml(c, 'campaign');
    const [, , left] = html.split(/<div class="panel( alt)?">/);
    expect(count(left, 'class="erow"')).toBe(4);
    expect(left).toContain('E3');
    expect(left).toContain('A1');
    expect(left).not.toContain('B2');
  });
});

describe('sparse cards fill their frame', () => {
  const out = (n: string) => path.join(tmpdir(), `iolar-sparse-${n}-${Date.now()}.png`);

  it('the scraped-style job leaves little slack and never overflows', async () => {
    for (const family of FAMILIES as readonly Family[]) {
      const r = await renderFamily(sparse(), family, out(`min-${family}`));
      expect(r.overflowPx, `${family} overflow`).toBe(0);
      expect(r.slackPx, `${family} slack`).toBeLessThanOrEqual(90);
      console.log('sparse', family, 'overflowPx', r.overflowPx, 'slackPx', r.slackPx);
    }
  }, 180_000);

  it('a one-skill job fills both families', async () => {
    for (const family of FAMILIES as readonly Family[]) {
      const r = await renderFamily(sparse(['Node.js']), family, out(`tiny-${family}`));
      expect(r.overflowPx, `${family} overflow`).toBe(0);
      expect(r.slackPx, `${family} slack`).toBeLessThanOrEqual(110);
      console.log('tiny', family, 'overflowPx', r.overflowPx, 'slackPx', r.slackPx);
    }
  }, 180_000);

  it('the full job is unchanged', async () => {
    for (const family of FAMILIES as readonly Family[]) {
      const r = await renderFamily(full, family, out(`full-${family}`));
      expect(r.overflowPx, `${family} overflow`).toBe(0);
    }
  }, 180_000);
});
