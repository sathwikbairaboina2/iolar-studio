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

/** The fixture is a full job: every field filled, four rounds, two dates. Only the
 *  families the spec sends that document to are expected to hold it whole. */
const HOLDS_A_FULL_JOB = ['campaign', 'bento', 'ticket', 'band-stack'];

afterAll(async () => {
  await closeBrowser();
});

describe('a job card renders', () => {
  it.each(FAMILIES)('%s says every mandatory field', (family) => {
    const html = buildCardHtml(card, family);
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
    const html = buildCardHtml({ ...card, cta: { ...card.cta, channel: 'site' } }, 'band-stack');
    expect(html).toContain('apply on aiiolar.com, link in bio');
    const rich = buildCardHtml({ ...card, cta: { ...card.cta, channel: 'site' } }, 'campaign');
    expect(rich).toContain('Apply on <b>aiiolar.com</b>');
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
    const r = await renderCard(rest as typeof card, 'band-stack', out);
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
});
