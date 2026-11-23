import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/jobs' }));

const base = {
  company: { name: 'Zoho', logo: null, accent: null },
  role: { title: 'Software Engineer I', skills: ['Java'], team: null },
  experience: { min: 0, max: 2, label: '0 – 2 Years' },
  location: { city: 'Chennai', region: 'India', workMode: 'onsite' },
  salary: { min: 6, max: 9, currency: 'INR', unit: 'LPA', note: null },
  eligibility: ['B.E/B.Tech 2024 or 2025 graduates'],
  selectionProcess: [],
  dates: [],
  source: { url: 'https://careers.example.com/1', kind: 'job-url', poolId: null },
};
const row = {
  id: 'zoho-se-1', createdAt: 'x', updatedAt: 'y', company: 'Zoho', role: 'Software Engineer I',
  sourceUrl: 'https://careers.example.com/1', sourceKind: 'job-url', poolId: null,
  family: null, missing: [], renderedAt: null, overflowPx: null, fellBack: null,
};

let stored: Record<string, unknown> = {};
let puts: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

afterEach(() => cleanup());
beforeEach(() => {
  vi.resetModules();
  puts = [];
  stored = { ...base, cta: { channel: 'site', keyword: 'ZOHO', url: 'https://aiiolar.com/jobs?q=Software%20Engineer%20I%20Zoho' } };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (u.endsWith('/api/jobcards/zoho-se-1')) {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return json({ row, draft: puts[puts.length - 1], missing: [] });
      }
      return json({ row, draft: stored, missing: [], families: [{ family: 'band-stack', score: 5, why: 'x' }] });
    }
    if (u.includes('/api/jobcards')) return json({ cards: [row], total: 1 });
    return json({});
  });
});

const openCard = async () => {
  const Pane = (await import('@/components/jobs/JobCardPane')).default;
  render(<Pane />);
  await waitFor(() => expect(screen.getByTestId('jobcard-row-zoho-se-1')).toBeTruthy());
  fireEvent.click(screen.getByTestId('jobcard-row-zoho-se-1'));
  await waitFor(() => expect(screen.getByTestId('jobcard-company')).toBeTruthy());
};

describe('the apply link editor', () => {
  it('shows the card\'s site link, editable, and saves an edit', async () => {
    await openCard();
    const url = screen.getByTestId('jobcard-cta-url') as HTMLInputElement;
    expect(url.value).toBe('https://aiiolar.com/jobs?q=Software%20Engineer%20I%20Zoho');
    fireEvent.change(url, { target: { value: 'https://aiiolar.com/jobs?job=zoho' } });
    fireEvent.click(screen.getByTestId('jobcard-save'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].cta).toMatchObject({ channel: 'site', url: 'https://aiiolar.com/jobs?job=zoho', keyword: 'ZOHO' });
  });

  it('offers the site channel in the list, and a card with no channel starts on it', async () => {
    stored = { ...base };
    await openCard();
    // antd's Select renders the chosen label in its selection item.
    const picker = screen.getByTestId('jobcard-channel');
    expect(picker.textContent).toContain('site');
    fireEvent.mouseDown((picker.closest('.ant-select') ?? picker).querySelector('.ant-select-content, .ant-select-selector') ?? picker);
    await waitFor(() => expect(document.querySelectorAll('.ant-select-item-option').length).toBe(4));
    const labels = Array.from(document.querySelectorAll('.ant-select-item-option')).map((n) => n.textContent);
    expect(labels).toEqual(['site', 'whatsapp', 'bio', 'dm']);
  });

  it('keeps a stored whatsapp channel and hides the link box for it', async () => {
    stored = { ...base, cta: { channel: 'whatsapp', keyword: 'ZOHO' } };
    await openCard();
    expect(screen.getByTestId('jobcard-channel').textContent).toContain('whatsapp');
    expect(screen.queryByTestId('jobcard-cta-url')).toBeNull();
  });
});
