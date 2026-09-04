import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  companySite, domainMatchesCompany, iconCandidates, isAtsHost, isUsableMark, markCandidates, markupLogo, searxngSearch,
} from '@/lib/jobcard/logo';
import { jsonLdBlocks } from '@/lib/jobcard/extract';

/**
 * The mark on a card has to be the company's. An applicant tracking system serves the
 * listing and every icon on that page is the tracking system's own — taking one puts
 * Ashby's logo on Sarvam's card, which is worse than a wordmark.
 */

const ATS_PAGE = `<!doctype html><html><head>
  <link rel="icon" type="image/svg+xml" href="https://cdn.ashbyprd.com/cdn_assets/favicon.svg">
  <link rel="apple-touch-icon" sizes="180x180" href="https://cdn.ashbyprd.com/cdn_assets/apple-touch-icon.png">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"JobPosting","title":"Performance Engineer",
   "hiringOrganization":{"@type":"Organization","name":"Sarvam","sameAs":"https://www.sarvam.ai/"}}
  </script>
</head><body></body></html>`;

const COMPANY_PAGE = `<!doctype html><html><head>
  <link rel="icon" type="image/x-icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
  <meta property="og:image" content="https://assets.sarvam.ai/og/home.png">
</head><body></body></html>`;

const OWN_SITE_PAGE = `<!doctype html><html><head>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"JobPosting","title":"SDE",
   "hiringOrganization":{"@type":"Organization","name":"Zoho","logo":"https://zoho.com/mark.png"}}
  </script>
  <link rel="apple-touch-icon" href="/touch.png" sizes="180x180">
</head><body></body></html>`;

describe('finding the company’s own mark', () => {
  it('knows a page that only hosts other people’s jobs', () => {
    expect(isAtsHost('https://jobs.ashbyhq.com/sarvam/123')).toBe(true);
    expect(isAtsHost('https://boards.greenhouse.io/acme/jobs/1')).toBe(true);
    expect(isAtsHost('https://www.sarvam.ai/careers')).toBe(false);
  });

  it('takes the logo the posting itself publishes', () => {
    expect(markupLogo(jsonLdBlocks(OWN_SITE_PAGE), 'https://zoho.com/jobs/1')).toBe('https://zoho.com/mark.png');
    expect(markupLogo(jsonLdBlocks(ATS_PAGE), 'https://jobs.ashbyhq.com/sarvam/1')).toBeNull();
  });

  it('follows the markup to the company’s own site', () => {
    expect(companySite(jsonLdBlocks(ATS_PAGE), 'https://jobs.ashbyhq.com/sarvam/1')).toBe('https://www.sarvam.ai/');
    // A company careers page is its own site; a tracking system is nobody's.
    expect(companySite([], 'https://careers.zoho.com/jobs/1')).toBe('https://careers.zoho.com');
    expect(companySite([], 'https://jobs.lever.co/acme/1')).toBeNull();
  });

  it('ranks a touch icon over a favicon, and a social banner last', () => {
    const urls = iconCandidates(COMPANY_PAGE, 'https://www.sarvam.ai/');
    expect(urls[0]).toBe('https://www.sarvam.ai/apple-touch-icon.png');
    expect(urls.at(-1)).toBe('https://assets.sarvam.ai/og/home.png');
  });

  it('never offers the tracking system’s own icons', async () => {
    const marks = await markCandidates(jsonLdBlocks(ATS_PAGE), 'https://jobs.ashbyhq.com/sarvam/1', ATS_PAGE, async () => ({
      html: COMPANY_PAGE,
      url: 'https://www.sarvam.ai/',
    }));
    expect(marks.every((m) => !m.url.includes('ashbyprd.com'))).toBe(true);
    expect(marks[0]).toEqual({ url: 'https://www.sarvam.ai/apple-touch-icon.png', from: 'company-site' });
  });

  it('takes the job page’s icons when the job page is the company’s own', async () => {
    const marks = await markCandidates(jsonLdBlocks(OWN_SITE_PAGE), 'https://zoho.com/jobs/1', OWN_SITE_PAGE);
    expect(marks[0]).toEqual({ url: 'https://zoho.com/mark.png', from: 'markup' });
    expect(marks.some((m) => m.url === 'https://zoho.com/touch.png' && m.from === 'job-page')).toBe(true);
  });

  it('searches for the company site when the listing gives nothing', async () => {
    // What an aggregator behind a bot check leaves behind: no page, no markup, just a name.
    const marks = await markCandidates(
      [],
      'https://himalayas.app/companies/snapscale/jobs/1',
      '',
      async () => ({ html: COMPANY_PAGE, url: 'https://snapscale.co/' }),
      {
        company: 'Snapscale',
        search: async (q) => {
          expect(q).toContain('Snapscale');
          return ['https://himalayas.app/companies/snapscale', 'https://snapscale.co/about'];
        },
      }
    );
    // The aggregator is skipped; the company's own site is read.
    expect(marks[0].from).toBe('search');
    expect(marks[0].url).toBe('https://snapscale.co/apple-touch-icon.png');
  });

  it('only believes a searched domain that is the company’s own', () => {
    expect(domainMatchesCompany('https://www.snapscale.com/', 'Snapscale')).toBe(true);
    expect(domainMatchesCompany('https://careers.zoho.com/x', 'Zoho Corporation')).toBe(true);
    expect(domainMatchesCompany('https://www.microsoft.com/', 'Snapscale')).toBe(false);
    // A short name would match half the web, so it never matches at all.
    expect(domainMatchesCompany('https://ola.com/', 'Ola')).toBe(false);
  });

  it('takes no mark at all rather than the wrong company’s', async () => {
    const marks = await markCandidates([], 'https://himalayas.app/x/1', '', async () => ({
      html: COMPANY_PAGE,
      url: 'https://www.microsoft.com/',
    }), {
      company: 'Snapscale',
      search: async () => ['https://www.microsoft.com/en-in/snapscale'],
    });
    expect(marks).toEqual([]);
  });

  it('does not search when the listing already offered a mark', async () => {
    let searched = false;
    const marks = await markCandidates(jsonLdBlocks(OWN_SITE_PAGE), 'https://zoho.com/jobs/1', OWN_SITE_PAGE, undefined, {
      company: 'Zoho',
      search: async () => {
        searched = true;
        return [];
      },
    });
    expect(searched).toBe(false);
    expect(marks[0].from).toBe('markup');
  });

  it('reads a SearXNG answer as a list of urls, and a dead one as nothing', async () => {
    const ok = searxngSearch('http://127.0.0.1:25180/', (async () => ({
      ok: true,
      json: async () => ({ results: [{ url: 'https://snapscale.co/' }, { title: 'no url' }] }),
    })) as unknown as typeof fetch);
    expect(await ok('Snapscale official website')).toEqual(['https://snapscale.co/']);

    const down = searxngSearch('http://127.0.0.1:25180', (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch);
    expect(await down('anything')).toEqual([]);
  });

  it('keeps a square mark and refuses a banner or a tiny favicon', async () => {
    const square = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#123456' } }).png().toBuffer();
    const banner = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#123456' } }).png().toBuffer();
    const tiny = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#123456' } }).png().toBuffer();

    expect(await isUsableMark(square)).toBe(true);
    expect(await isUsableMark(banner)).toBe(false);
    expect(await isUsableMark(tiny)).toBe(false);
    expect(await isUsableMark(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
