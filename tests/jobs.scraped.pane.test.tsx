import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/jobs' }));

const draft = {
  company: { name: 'Zoho', logo: null, accent: null },
  role: { title: 'Software Engineer I', skills: ['Java'], team: null },
  experience: { min: 0, max: 2, label: '0 – 2 Years' },
  location: { city: 'Chennai', region: 'India', workMode: 'onsite' },
  salary: { min: 6, max: 9, currency: 'INR', unit: 'LPA', note: null },
  eligibility: ['B.E/B.Tech 2024 or 2025 graduates'],
  selectionProcess: [],
  dates: [],
  cta: { channel: 'whatsapp', keyword: 'ZOHO' },
  source: { url: 'https://instagram.com/p/hiring.daily.mock-0/', kind: 'reference', poolId: null },
};
const row = (id: string) => ({
  id, createdAt: 'x', updatedAt: 'y', company: 'Zoho', role: 'Software Engineer I',
  sourceUrl: 'https://instagram.com/p/hiring.daily.mock-0/', sourceKind: 'reference', poolId: null,
  family: null, missing: [], renderedAt: null, overflowPx: null, fellBack: null,
});
const items = [
  {
    shortcode: 'hiring.daily.mock-0', username: 'hiring.daily.mock',
    igUrl: 'https://instagram.com/p/hiring.daily.mock-0/',
    caption: 'Hiring: Software Engineer I\nCompany: Zoho', status: 'selected',
    addedAt: 'z', thumbUrl: 'http://scraper/api/media/a/thumb', cardId: null,
  },
  {
    shortcode: 'hiring.daily.mock-1', username: 'hiring.daily.mock',
    igUrl: 'https://instagram.com/p/hiring.daily.mock-1/',
    caption: 'Hiring: Data Analyst\nCompany: Freshworks', status: 'prepared',
    addedAt: 'z', thumbUrl: 'http://scraper/api/media/b/thumb', cardId: 'freshworks-data-analyst-ab12',
  },
];

let posted: { url: string; body: unknown }[] = [];
let scraperDown = false;

afterEach(() => cleanup());
beforeEach(() => {
  vi.resetModules();
  posted = [];
  scraperDown = false;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (init?.method === 'POST') {
      posted.push({ url: u, body: JSON.parse(String(init.body)) });
      return json({ id: 'zoho-se-1', row: row('zoho-se-1'), draft, missing: [] }, 201);
    }
    if (u.endsWith('/api/jobcards/scraped')) {
      return scraperDown ? json({ error: 'the scraper did not answer (connect ECONNREFUSED)' }, 502) : json({ items });
    }
    if (u.endsWith('/api/jobcards/zoho-se-1') || u.endsWith('/api/jobcards/freshworks-data-analyst-ab12')) {
      return json({ row: row('zoho-se-1'), draft, missing: [], families: [{ family: 'band-stack', score: 5, why: 'x' }] });
    }
    if (u.includes('/api/jobcards')) return json({ cards: [], total: 0 });
    return json({});
  });
});

const openScraped = async () => {
  const Pane = (await import('@/components/jobs/JobCardPane')).default;
  render(<Pane />);
  fireEvent.click(screen.getByText('A scraped post'));
};

describe('the scraped post way in', () => {
  it('lists the scraper queue with thumbnail, handle, first caption line and status', async () => {
    await openScraped();
    await waitFor(() => expect(screen.getByTestId('scraped-row-hiring.daily.mock-0')).toBeTruthy());
    const first = screen.getByTestId('scraped-row-hiring.daily.mock-0');
    expect(first.textContent).toContain('@hiring.daily.mock');
    expect(first.textContent).toContain('Hiring: Software Engineer I');
    expect(first.textContent).not.toContain('Company: Zoho');
    expect(first.textContent).toContain('selected');
    expect(first.querySelector('img')?.getAttribute('src')).toBe('http://scraper/api/media/a/thumb');
    // A post with a card offers it; a post without one offers to make it.
    expect(screen.getByTestId('scraped-make-hiring.daily.mock-0')).toBeTruthy();
    expect(screen.getByTestId('scraped-open-hiring.daily.mock-1')).toBeTruthy();
  });

  it('makes a card from the row and opens it', async () => {
    await openScraped();
    await waitFor(() => expect(screen.getByTestId('scraped-make-hiring.daily.mock-0')).toBeTruthy());
    fireEvent.click(screen.getByTestId('scraped-make-hiring.daily.mock-0'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].url.endsWith('/api/jobcards')).toBe(true);
    expect(posted[0].body).toMatchObject({ scraped: 'hiring.daily.mock-0' });
    await waitFor(() => expect((screen.getByTestId('jobcard-company') as HTMLInputElement).value).toBe('Zoho'));
  });

  it('opens an existing card without posting', async () => {
    await openScraped();
    await waitFor(() => expect(screen.getByTestId('scraped-open-hiring.daily.mock-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('scraped-open-hiring.daily.mock-1'));
    await waitFor(() => expect(screen.getByTestId('jobcard-company')).toBeTruthy());
    expect(posted).toHaveLength(0);
  });

  it('says so when the scraper is unreachable', async () => {
    scraperDown = true;
    await openScraped();
    await waitFor(() => expect(screen.getByTestId('scraped-error')).toBeTruthy());
    expect(screen.getByTestId('scraped-error').textContent).toMatch(/scraper did not answer/);
  });

  it('keeps the other two ways as they were', async () => {
    const Pane = (await import('@/components/jobs/JobCardPane')).default;
    render(<Pane />);
    expect(screen.getByTestId('jobcard-url')).toBeTruthy();
    expect(screen.getByText('A pool row')).toBeTruthy();
  });
});
