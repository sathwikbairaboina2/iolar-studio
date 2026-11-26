import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { FAMILIES, ratioFor, parseJobCard } from '@/lib/jobcard/schema';
import { buildCardHtml } from '@/lib/jobcard/build';
import { renderCard, closeBrowser } from '@/lib/jobcard/render';

const card = parseJobCard(
  JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/jobcard.json'), 'utf8'))
);

/** The fixture is a full job: every field filled, four rounds, two dates. Both
 *  families are expected to hold it whole. */
/** A card the way the scraper leaves it: no dates, no rounds, no pay, little to say. */
const minimal = () =>
  parseJobCard({
    company: { name: 'Acme Labs', logo: null },
    role: { title: 'Backend Developer', skills: ['Node.js', 'SQL'] },
    experience: { min: 1, max: 3, label: '1 – 3 Years' },
    location: { city: 'Pune', region: null, workMode: 'onsite' },
    eligibility: ['Any graduate'],
    selectionProcess: [],
    dates: [],
    cta: { channel: 'site' },
    source: { url: 'https://acme.example/jobs/1', kind: 'job-url', poolId: null },
  });

const OLD_COLOURS = [
  '#141b26', '#101820', '#1b2431', '#2a3442', '#3b4757', '#42506b', '#48566a', '#4a5666',
  '#5b6673', '#6b7788', '#7b8798', '#8a93a4', '#d3dae6', '#dfe5ee', '#e2e7f0', '#e7ebf2',
  '#e9edf4', '#eaeef4', '#eef1f6', '#f2f5fa', '#eef1f7', '#dbe6fb', '#f5f7fb', '#b9cdf5',
  '#93b0ec', 'rgba(20,30,60,.12)', '#5b2a86', '#12855a', '#1256b8', '#e2622b',
];

const HOLDS_A_FULL_JOB = ['campaign', 'infographic'];

afterAll(async () => {
  await closeBrowser();
});

describe('a job card renders', () => {
  it.each(FAMILIES)('%s says every mandatory field', (family) => {
    // The accent word of the title sits in its own span, so the card is read as text.
    const html = buildCardHtml(card, family).replace(/<[^>]+>/g, '');
    for (const said of [
      'Zoho',
      'Software Development Engineer',
      '2 – 5 Years',
      'Chennai',
      'LPA',
      'B.E. / B.Tech / MCA',
      'ZOHO',
    ]) {
      expect(html, `${family} dropped "${said}"`).toContain(said);
    }
  });

  it.each(FAMILIES)('%s says "Apply on aiiolar.com" for the site channel, and keeps the old wording otherwise', (family) => {
    const site = buildCardHtml({ ...card, cta: { ...card.cta, channel: 'site' } }, family);
    expect(site, `${family} did not name the site`).toMatch(/aiiolar\.com/);
    expect(site).not.toContain('WhatsApp');
    expect(buildCardHtml({ ...card, cta: { ...card.cta, channel: 'whatsapp' } }, family)).toContain('WhatsApp');
  });

  it('words the site channel as an apply line on the card', () => {
    const html = buildCardHtml({ ...card, cta: { ...card.cta, channel: 'site' } }, 'campaign');
    expect(html).toContain('Apply on <b>aiiolar.com</b>');
    expect(html).toContain('link in bio');
  });

  it.each(FAMILIES)('%s prints Not disclosed when the card has no salary', (family) => {
    const { salary: _drop, ...rest } = card;
    void _drop;
    const html = buildCardHtml(rest as typeof card, family);
    expect(html, `${family} lost its salary line`).toContain('Not disclosed');
    expect(html).not.toContain('LPA');
    expect(html).not.toContain('NaN');
  });

  it('renders a card with no salary to a PNG that fits', async () => {
    const { salary: _drop, ...rest } = card;
    void _drop;
    const out = path.join(tmpdir(), `iolar-jobcard-nosalary-${Date.now()}.png`);
    const r = await renderCard(rest as typeof card, 'campaign', out);
    expect(existsSync(out)).toBe(true);
    expect(r.overflowPx).toBe(0);
  }, 180_000);

  it.each(FAMILIES)(
    '%s renders a card that fits, itself or through the fallback',
    async (family) => {
      const out = path.join(tmpdir(), `iolar-jobcard-${family}-${Date.now()}.png`);
      const r = await renderCard(card, family, out);
      expect(existsSync(out), `${family} produced no image`).toBe(true);
      expect(r.overflowPx, `${family} ran ${r.overflowPx}px past its frame`).toBe(0);
      expect([r.width, r.height]).toEqual(ratioFor(r.family));
      if (HOLDS_A_FULL_JOB.includes(family)) {
        expect(r.fellBack, `${family} should hold a full job itself`).toBe(false);
        expect(r.family).toBe(family);
      }
    },
    180_000
  );

  it('prints @aiiolar unless told otherwise', () => {
    expect(buildCardHtml(card, 'campaign')).toContain('@aiiolar');
    expect(buildCardHtml(card, 'infographic')).toContain('@aiiolar');
    expect(buildCardHtml(card, 'campaign', { brand: 'other' })).toContain('@other');
  });

  it.each(FAMILIES)('%s is painted in the brand gradient, with no old slate or coin colours left', (family) => {
    const root = path.join(process.cwd(), 'templates', '_jobcard');
    const css = readFileSync(path.join(root, '_shared', 'card.css'), 'utf8');
    const tpl = readFileSync(path.join(root, family, 'template.html'), 'utf8');
    const all = (css + tpl + buildCardHtml(card, family)).toLowerCase();
    expect(css).toContain('--grad');
    expect(css).toContain('--deep');
    expect(tpl).toMatch(/var\(--(grad|deep)\)/);
    for (const old of OLD_COLOURS) expect(all, `${family} still has ${old}`).not.toContain(old.toLowerCase());
    expect(all).not.toContain('#1650e0');
  });

  it.each(FAMILIES)('%s prints no empty sections for a scraped-style card', (family) => {
    const html = buildCardHtml(minimal(), family);
    expect(html).not.toContain('Apply before');
    expect(html).not.toContain('Selection');
    expect(html).not.toContain('Test date');
    expect(html).not.toContain('NaN');
    expect(html).not.toMatch(/class="panel[^"]*"><div class="ph">[^<]*<\/div><div class="body"><\/div>/);
    expect(html).not.toMatch(/<div class="dates"><\/div>/);
  });

  it.each(FAMILIES)(
    '%s renders a scraped-style card that fits, itself or through the fallback',
    async (family) => {
      const out = path.join(tmpdir(), `iolar-jobcard-min-${family}-${Date.now()}.png`);
      const r = await renderCard(minimal(), family, out);
      expect(existsSync(out)).toBe(true);
      expect(r.overflowPx, `${family} ran ${r.overflowPx}px past its frame`).toBe(0);
      if (r.fellBack) expect(r.family).toBe('campaign');
    },
    180_000
  );
});
