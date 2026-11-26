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
  source: { url: 'https://careers.example.com/1', kind: 'job-url', poolId: null },
};
const row = (renderedAt: string | null) => ({
  id: 'zoho-se-1', createdAt: 'x', updatedAt: 'y', company: 'Zoho', role: 'Software Engineer I',
  sourceUrl: 'https://careers.example.com/1', sourceKind: 'job-url', poolId: null,
  family: renderedAt ? 'campaign' : null, missing: [], renderedAt, overflowPx: null, fellBack: null,
});

let renderedAt: string | null = null;
let existing: unknown = null;
let handoffReply: { status: number; body: unknown } = { status: 200, body: {} };
let handoffCalls: string[] = [];
let release: (() => void) | null = null;

afterEach(() => cleanup());
beforeEach(() => {
  vi.resetModules();
  renderedAt = null;
  existing = null;
  handoffCalls = [];
  release = null;
  handoffReply = {
    status: 200,
    body: { handoff: { postId: 'post-9', accountId: 'acct-1', at: 'now', status: 'queued' }, caption: 'c', created: true },
  };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (u.endsWith('/api/jobcards/zoho-se-1/handoff') && init?.method === 'POST') {
      handoffCalls.push(u);
      if (release === null && (globalThis as { __hold?: boolean }).__hold) await new Promise<void>((r) => (release = r));
      return json(handoffReply.body, handoffReply.status);
    }
    if (u.endsWith('/api/jobcards/zoho-se-1/render') && init?.method === 'POST') {
      renderedAt = new Date().toISOString();
      return json({ family: 'campaign', fellBack: false });
    }
    if (u.endsWith('/api/jobcards/zoho-se-1')) {
      return json({
        row: row(renderedAt), draft, missing: [],
        families: [{ family: 'campaign', score: 5, why: 'x' }], handoff: existing,
      });
    }
    if (u.includes('/api/jobcards')) return json({ cards: [row(renderedAt)], total: 1 });
    return json({});
  });
});
afterEach(() => {
  delete (globalThis as { __hold?: boolean }).__hold;
});

const openCard = async () => {
  const Pane = (await import('@/components/jobs/JobCardPane')).default;
  render(<Pane />);
  await waitFor(() => expect(screen.getByTestId('jobcard-row-zoho-se-1')).toBeTruthy());
  fireEvent.click(screen.getByTestId('jobcard-row-zoho-se-1'));
  await waitFor(() => expect(screen.getByTestId('jobcard-company')).toBeTruthy());
};

describe('sending a rendered card to IntaBot', () => {
  it('offers nothing before the card is rendered, then offers the button after a render', async () => {
    await openCard();
    expect(screen.queryByTestId('jobcard-handoff')).toBeNull();

    fireEvent.click(screen.getByTestId('jobcard-render'));
    await waitFor(() => expect(screen.getByTestId('jobcard-handoff')).toBeTruthy());
    expect(screen.getByTestId('jobcard-handoff').textContent).toContain('Send to IntaBot');
  });

  it('posts the handoff and shows the queued post', async () => {
    renderedAt = '2026-11-23T10:00:00.000Z';
    await openCard();
    fireEvent.click(screen.getByTestId('jobcard-handoff'));
    await waitFor(() => expect(screen.getByTestId('jobcard-handoff-status')).toBeTruthy());
    expect(handoffCalls).toHaveLength(1);
    expect(screen.getByTestId('jobcard-handoff-status').textContent).toContain('Queued in IntaBot · post post-9');
  });

  it('disables the button while the request is out', async () => {
    renderedAt = '2026-11-23T10:00:00.000Z';
    (globalThis as { __hold?: boolean }).__hold = true;
    await openCard();
    fireEvent.click(screen.getByTestId('jobcard-handoff'));
    await waitFor(() => expect(handoffCalls).toHaveLength(1));
    const btn = screen.getByTestId('jobcard-handoff') as HTMLButtonElement;
    expect(btn.disabled || btn.className.includes('loading')).toBe(true);
    fireEvent.click(btn);
    expect(handoffCalls).toHaveLength(1);
    release?.();
    await waitFor(() => expect(screen.getByTestId('jobcard-handoff-status')).toBeTruthy());
  });

  it('shows IntaBot\'s error and no queued line when the handoff fails', async () => {
    renderedAt = '2026-11-23T10:00:00.000Z';
    handoffReply = { status: 502, body: { error: 'IntaBot did not answer (connect ECONNREFUSED)' } };
    await openCard();
    fireEvent.click(screen.getByTestId('jobcard-handoff'));
    await waitFor(() => expect(screen.getByTestId('jobcard-handoff-error')).toBeTruthy());
    expect(screen.getByTestId('jobcard-handoff-error').textContent).toMatch(/IntaBot did not answer/);
    expect(screen.queryByTestId('jobcard-handoff-status')).toBeNull();
  });

  it('shows an earlier handoff when the card is opened', async () => {
    renderedAt = '2026-11-23T10:00:00.000Z';
    existing = { postId: 'post-3', accountId: 'acct-1', at: '2026-11-23T09:00:00.000Z', status: 'queued' };
    await openCard();
    expect(screen.getByTestId('jobcard-handoff-status').textContent).toContain('Queued in IntaBot · post post-3');
  });
});
