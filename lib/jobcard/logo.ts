import sharp from 'sharp';

/**
 * The mark must be the company's own.
 *
 * A listing on Ashby, Greenhouse or Lever is served by the applicant tracking system, and
 * every icon on that page belongs to the tracking system — its favicon, its touch icon,
 * its social card. Taking one of those puts Ashby's mark on Sarvam's card, which is worse
 * than having no mark at all: it is another company's logo presented as this one's.
 *
 * So the order is: what the posting's own markup says the hiring organisation's logo is;
 * then the company's own website, found through that markup; then the job page itself, but
 * only when the job page is the company's own site. A wordmark set in heavy type is the
 * honest end of the line.
 */

/** Hosts that serve other people's jobs. A mark from one of these is never the company's. */
const ATS_HOSTS = [
  'ashbyhq.com',
  'greenhouse.io',
  'lever.co',
  'workday.com',
  'myworkdayjobs.com',
  'smartrecruiters.com',
  'recruitee.com',
  'jobvite.com',
  'icims.com',
  'bamboohr.com',
  'zohorecruit.com',
  'keka.com',
  'darwinbox.com',
  'freshteam.com',
  'workable.com',
  'teamtailor.com',
  'personio.de',
  'linkedin.com',
  'indeed.com',
  'naukri.com',
  'glassdoor.com',
  'wellfound.com',
  'ycombinator.com',
  // Aggregators: they republish other people's postings, so their mark is never the company's.
  'himalayas.app',
  'remoteok.com',
  'weworkremotely.com',
  'remotive.com',
  'jobicy.com',
  'otta.com',
  'jobspresso.co',
  'builtin.com',
];

export function isAtsHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return ATS_HOSTS.some((ats) => host === ats || host.endsWith(`.${ats}`));
  } catch {
    return false;
  }
}

type JsonLd = Record<string, unknown>;

const absolute = (href: string, base: string): string | null => {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
};

const posting = (blocks: JsonLd[]) => blocks.find((b) => String(b['@type'] ?? '').includes('JobPosting'));

/** `hiringOrganization.logo`, whether it is a URL or an ImageObject. */
export function markupLogo(blocks: JsonLd[], base: string): string | null {
  const org = posting(blocks)?.hiringOrganization as JsonLd | undefined;
  const logo = org?.logo;
  const href =
    typeof logo === 'string' ? logo : typeof (logo as JsonLd)?.url === 'string' ? ((logo as JsonLd).url as string) : null;
  return href ? absolute(href, base) : null;
}

/** The company's own site: what the markup points at, or the job page when it is not an ATS. */
export function companySite(blocks: JsonLd[], pageUrl: string): string | null {
  const org = posting(blocks)?.hiringOrganization as JsonLd | undefined;
  const named = [org?.sameAs, org?.url]
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .find((v): v is string => typeof v === 'string' && /^https?:\/\//i.test(v) && !isAtsHost(v));
  if (named) return named;
  try {
    return isAtsHost(pageUrl) ? null : new URL(pageUrl).origin;
  } catch {
    return null;
  }
}

/**
 * A page's icons, squarest and largest first. The social card is last and usually loses the
 * shape check that follows — a 1200×630 banner is not a mark.
 */
export function iconCandidates(html: string, base: string): string[] {
  const found: { href: string; rank: number }[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = tag.match(/rel=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? '';
    if (!/icon/.test(rel)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const size = Number(tag.match(/sizes=["'](\d+)/i)?.[1] ?? 0);
    // An apple touch icon is the one a site draws for a square tile, so it is the best guess.
    const rank = (/apple-touch-icon/.test(rel) ? 1000 : 0) + size + (/\.svg($|\?)/i.test(href) ? 200 : 0);
    found.push({ href, rank });
  }
  const social =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];

  const urls = found
    .sort((a, b) => b.rank - a.rank)
    .map((f) => absolute(f.href, base))
    .filter((u): u is string => !!u);
  const socialUrl = social ? absolute(social, base) : null;
  return [...new Set([...urls, ...(socialUrl ? [socialUrl] : [])])];
}

export type MarkSource = 'markup' | 'company-site' | 'job-page' | 'search';
export type FoundMark = { url: string; from: MarkSource };

export type PageRead = (url: string) => Promise<{ html: string; url: string }>;

export type SearchFn = (query: string) => Promise<string[]>;

const letters = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A searched domain has to be the company's, and the only evidence available is the name.
 * "Snapscale" against snapscale.com is a match; against microsoft.com it is not, and a
 * search that lands on the wrong company must produce nothing rather than that company's
 * logo. Four characters is the floor, so a two-letter name cannot match half the web.
 */
export function domainMatchesCompany(url: string, company: string): boolean {
  const name = letters(company);
  if (name.length < 4) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    // Every label but the suffix is a candidate, so careers.zoho.com answers for Zoho.
    return host
      .split('.')
      .slice(0, -1)
      .map(letters)
      .filter((label) => label.length >= 4)
      .some((label) => name.includes(label) || label.includes(name));
  } catch {
    return false;
  }
}

/**
 * The local SearXNG the research stack already runs. A company whose listing hides behind
 * an aggregator's bot check still has a website, and this is how it is found — locally,
 * with no key and nothing leaving the machine.
 */
export function searxngSearch(baseUrl: string, fetchImpl: typeof fetch = fetch): SearchFn {
  return async (query: string) => {
    const url = `${baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`;
    try {
      const r = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!r.ok) return [];
      const body = (await r.json()) as { results?: { url?: string }[] };
      return (body.results ?? []).map((x) => x.url).filter((u): u is string => typeof u === 'string');
    } catch {
      return [];
    }
  };
}

/**
 * Where to look, in order. Nothing is downloaded here — the caller fetches, checks the
 * shape, and moves to the next candidate when one turns out to be a banner or a 404.
 *
 * The search is last and only runs when the first three found nothing, because a searched
 * site is a guess: the first result that is neither a job board nor an aggregator.
 */
export async function markCandidates(
  blocks: JsonLd[],
  pageUrl: string,
  html: string,
  read?: PageRead,
  opts: { company?: string | null; search?: SearchFn } = {}
): Promise<FoundMark[]> {
  const out: FoundMark[] = [];
  const fromMarkup = markupLogo(blocks, pageUrl);
  if (fromMarkup) out.push({ url: fromMarkup, from: 'markup' });

  const site = companySite(blocks, pageUrl);
  if (site && read) {
    try {
      const page = await read(site);
      for (const url of iconCandidates(page.html, page.url)) out.push({ url, from: 'company-site' });
    } catch {
      // A company site that will not answer is simply not a source.
    }
  }

  // The job page's own icons are the tracking system's unless the job page is the company's.
  if (!isAtsHost(pageUrl)) {
    for (const url of iconCandidates(html, pageUrl)) out.push({ url, from: 'job-page' });
  }

  if (out.length === 0 && opts.company && opts.search && read) {
    const hits = await opts.search(`${opts.company} official website`);
    const site = hits.find(
      (u) => /^https?:\/\//i.test(u) && !isAtsHost(u) && domainMatchesCompany(u, opts.company!)
    );
    if (site) {
      try {
        const page = await read(new URL(site).origin);
        for (const url of iconCandidates(page.html, page.url)) out.push({ url, from: 'search' });
      } catch {
        // A guess that will not load is simply not a source.
      }
    }
  }

  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.url) ? false : seen.add(m.url)));
}

/**
 * A mark is square-ish and big enough to set in a rounded tile. The card's tile is square
 * and 76 pixels, so the bar is 48 pixels on the short side and a shape between 3:5 and
 * 8:5 — which keeps a slightly wide logo and refuses the two things that are not marks at
 * all: a 1200×630 social banner (1.9) and a 16×16 favicon. Failing is the point; the
 * wordmark beats both.
 */
export async function isUsableMark(bytes: Uint8Array): Promise<boolean> {
  try {
    const meta = await sharp(bytes).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return meta.format === 'svg';
    const ratio = w / h;
    return Math.min(w, h) >= 48 && ratio >= 0.6 && ratio <= 1.6;
  } catch {
    return false;
  }
}
