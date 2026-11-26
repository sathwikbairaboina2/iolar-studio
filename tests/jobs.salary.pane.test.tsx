import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/jobs' }));

const base = {
  company: { name: 'Zoho', logo: null, accent: null },
  role: { title: 'Software Engineer I', skills: ['Java'], team: null },
  experience: { min: 0, max: 2, label: '0 – 2 Years' },
  location: { city: 'Chennai', region: 'India', workMode: 'onsite' },
  eligibility: ['B.E/B.Tech 2024 or 2025 graduates'],
  selectionProcess: [],
  dates: [],
  cta: { channel: 'whatsapp', keyword: 'ZOHO' },
  source: { url: 'https://careers.example.com/1', kind: 'job-url', poolId: null },
};
const row = {
  id: 'zoho-se-1', createdAt: 'x', updatedAt: 'y', company: 'Zoho', role: 'Software Engineer I',
  sourceUrl: 'https://careers.example.com/1', sourceKind: 'job-url', poolId: null,
  family: null, missing: [], renderedAt: null, overflowPx: null, fellBack: null,
};

let stored: Record<string, unknown> = {};
let puts: Record<string, unknown>[] = [];

afterEach(() => cleanup());
beforeEach(() => {
  vi.resetModules();
  puts = [];
  stored = { ...base, salary: { min: 6, max: 9, currency: 'INR', unit: 'LPA', note: null } };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (u.endsWith('/api/jobcards/zoho-se-1')) {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return json({ row, draft: puts[puts.length - 1], missing: [] });
      }
      return json({ row, draft: stored, missing: [], families: [{ family: 'campaign', score: 5, why: 'x' }] });
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
const input = (id: string) => screen.getByTestId(id) as HTMLInputElement;
const save = async (n: number) => {
  fireEvent.click(screen.getByTestId('jobcard-save'));
  await waitFor(() => expect(puts).toHaveLength(n));
  return puts[n - 1];
};

describe('the salary editor', () => {
  it('clears the salary with "Not disclosed", saving a card that has none', async () => {
    await openCard();
    expect(input('jobcard-salary-min').value).toBe('6');
    fireEvent.click(screen.getByTestId('jobcard-salary-clear'));
    await waitFor(() => expect(input('jobcard-salary-min').value).toBe(''));
    expect(input('jobcard-salary-max').value).toBe('');
    const body = await save(1);
    expect('salary' in body).toBe(false);
  });

  it('removes the salary when both numbers are emptied', async () => {
    await openCard();
    fireEvent.change(input('jobcard-salary-min'), { target: { value: '' } });
    fireEvent.change(input('jobcard-salary-max'), { target: { value: '' } });
    const body = await save(1);
    expect('salary' in body).toBe(false);
  });

  it('opens a salary-less card empty and never writes a 0-0 placeholder', async () => {
    delete stored.salary;
    await openCard();
    expect(input('jobcard-salary-min').value).toBe('');
    expect(input('jobcard-salary-max').value).toBe('');
    expect(screen.getByTestId('jobcard-salary-hint').textContent).toContain('Not disclosed');
    const untouched = await save(1);
    expect('salary' in untouched).toBe(false);

    fireEvent.change(input('jobcard-salary-min'), { target: { value: '8' } });
    const typed = (await save(2)).salary as { min: number; max: number };
    expect(typed.min).toBe(8);
    expect(typed.max).toBe(8);
    expect(JSON.stringify(typed)).not.toContain('"max":0');
  });
});
