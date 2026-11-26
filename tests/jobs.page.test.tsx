import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/jobs' }));

const pool = {
  filter: { category: 'india', techOnly: false },
  counts: { total: 1621, open: 1621, closed: 0, newSinceLastPull: 1421 },
  lastPull: { id: 2, at: '2026-09-02T13:40:00.000Z', fetched: 1621, added: 1421, refreshed: 200, closed: 0, error: null },
  sources: { enabled: 108, total: 119, lastError: null },
};
const cut = {
  id: 1,
  periodKey: '2026-W36',
  kind: 'weekly',
  windowFrom: '2026-08-31',
  windowTo: '2026-09-06',
  filter: {},
  status: 'thin',
  counted: 12,
  rejected: 1,
  summary: {
    counted: 12,
    rejected: 1,
    byWorkMode: { remote: 3, hybrid: 2, onsite: 7 },
    closingSoon: { within7Days: 0, nextDeadline: null },
    salaryCoverage: 0.25,
    byFunction: [{ key: 'engineering', label: 'Engineering', count: 9, share: 0.75 }],
    topEmployers: [{ company: 'Swiggy', count: 3 }],
    topCities: [{ city: 'Bengaluru', count: 8 }],
  },
  briefMd: '# The week',
  createdAt: 'x',
  updatedAt: '2026-09-02T14:00:00.000Z',
};
const detail = {
  cut,
  rows: [
    { cutId: 1, researchId: 1, row: { role: 'SDE II', company: 'Swiggy', function: 'engineering', experienceMin: 5, experienceMax: 9, workMode: 'onsite', location: 'Bengaluru' }, mappedBy: 'rule', rejectReason: null },
    { cutId: 1, researchId: 2, row: null, mappedBy: 'rejected', rejectReason: 'link: Invalid URL' },
  ],
  submissions: [],
};

const cardDraft = {
  company: { name: 'Zoho Corporation', logo: null, accent: null },
  role: { title: 'Software Development Engineer', skills: ['Java 17', 'Spring Boot'], team: null },
  experience: { min: 2, max: 5, label: '2 – 5 Years' },
  location: { city: 'Chennai', region: 'Tamil Nadu', workMode: 'hybrid' },
  salary: { min: 8, max: 18, currency: 'INR', unit: 'LPA', note: null },
  eligibility: ['B.E. / B.Tech / MCA, 60% throughout'],
  selectionProcess: [{ step: 1, label: 'Online assessment', detail: null }],
  dates: [],
  cta: { channel: 'whatsapp', keyword: 'ZOHO' },
  source: { url: 'https://careers.zohocorp.com/jobs/sde', kind: 'job-url', poolId: null },
};
const cardRow = {
  id: 'zoho-sde-1',
  createdAt: 'x',
  updatedAt: 'y',
  company: 'Zoho Corporation',
  role: 'Software Development Engineer',
  sourceUrl: 'https://careers.zohocorp.com/jobs/sde',
  sourceKind: 'job-url',
  poolId: null,
  family: null,
  missing: [],
  renderedAt: null,
  overflowPx: null,
  fellBack: null,
};
const cardFamilies = [
  { family: 'campaign', score: 5, why: 'nothing may be cut' },
  { family: 'infographic', score: 2, why: 'several requirements to list and no image worth showing' },
];
let made = false;

let posted: { url: string; body: unknown }[] = [];

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetModules();
  posted = [];
  made = false;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (init?.method === 'PUT') {
      posted.push({ url: u, body: init.body });
      if (u.includes('/api/jobs/cuts/1/voice')) return json({ ok: true, ownVoice: { format: 'm4a', bytes: 5, name: 'take.m4a', at: 'now' } });
    }
    if (init?.method === 'DELETE') {
      posted.push({ url: u, body: null });
      return json({ ok: true, cleared: true });
    }
    if (init?.method === 'POST') {
      posted.push({ url: u, body: init.body ? JSON.parse(String(init.body)) : null });
      if (u.endsWith('/api/jobs/cuts')) return json({ cut });
      if (u.endsWith('/submit')) return json({ cut: { ...cut, status: 'planned' }, submissions: [] });
      if (u.endsWith('/pull')) return json({ fetched: 1, added: 1, refreshed: 0, closed: 0, error: null });
      if (u.endsWith('/api/jobcards')) { made = true; return json({ id: 'zoho-sde-1', row: cardRow, draft: cardDraft, missing: [] }, 201); }
      if (u.endsWith('/api/jobcards/zoho-sde-1/render')) return json({ family: 'campaign', overflowPx: 0, fellBack: false, row: cardRow });
    }
    if (u.endsWith('/api/jobcards')) return json({ cards: made ? [cardRow] : [] });
    if (u.endsWith('/api/jobcards/zoho-sde-1')) return json({ row: cardRow, draft: cardDraft, missing: [], families: cardFamilies });
    if (u.endsWith('/api/jobcards/zoho-sde-1/render')) return json({ family: 'campaign', overflowPx: 0, fellBack: false, row: cardRow });
    if (u.endsWith('/api/jobs/pool')) return json(pool);
    if (u.endsWith('/api/jobs/styles')) return json({ board: 'http://127.0.0.1:26100', styles: [{ style: 'paper-doodle', world: 'classic', displayName: 'Paper & Doodle', captionMode: 'plain', fixed: [], elastic: { slots: '4-5', secondsEach: '6.4-8s', rehook: null }, request: { jobs: { method: 'POST', path: '/api/weeks/{week}/jobs', body: 'JobsFile' }, script: { method: 'POST', path: '/api/weeks/{week}/script', body: {} }, build: { method: 'POST', path: '/api/weeks/{week}/run', body: { stage: 'build' } } } }] });
    if (u.endsWith('/api/jobs/cuts')) return json({ cuts: posted.some((p) => p.url.endsWith('/api/jobs/cuts')) ? [cut] : [] });
    if (u.endsWith('/api/jobs/cuts/1')) {
      const dropped = posted.some((p) => p.url.includes('/cuts/1/voice') && p.body !== null);
      return json({ ...detail, ownVoice: dropped ? { format: 'm4a', bytes: 5, name: 'take.m4a', at: 'now' } : null });
    }
    if (u.endsWith('/api/jobs/weeks')) return json({ board: 'http://127.0.0.1:26100', weeks: [{ week: '2026-W46', stage: 'exported', counted: 150, rejected: 0, style: 'feed', build: 'done', hasExport: true, links: { board: 'b', reel: 'r', preview: 'p' } }] });
    return json({ error: 'no route' }, 404);
  });
});

describe('the jobs page', () => {
  it('shows the pool, prepares a week, opens the cut, and submits it with force', async () => {
    const Page = (await import('@/app/jobs/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText('New since last pull')).toBeTruthy());
    // antd's Statistic groups digits.
    expect(screen.getByText('1,421')).toBeTruthy();
    expect(screen.getByText('2026-W46')).toBeTruthy();

    fireEvent.click(screen.getByTestId('prepare-week'));
    await waitFor(() => expect(posted.some((p) => p.url.endsWith('/api/jobs/cuts'))).toBe(true));
    expect(posted.find((p) => p.url.endsWith('/api/jobs/cuts'))?.body).toMatchObject({ kind: 'weekly' });
    await waitFor(() => expect(screen.getByTestId('tiles')).toBeTruthy());
    expect(screen.getByText(/Thin cut: 12 rows/)).toBeTruthy();
    expect(screen.getByText('link: Invalid URL')).toBeTruthy();
    expect(screen.getByText('Swiggy 3')).toBeTruthy();

    const submit = screen.getByTestId('submit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('force'));
    await waitFor(() => expect((screen.getByTestId('submit') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => expect(posted.some((p) => p.url.endsWith('/api/jobs/cuts/1/submit'))).toBe(true));
    expect(posted.find((p) => p.url.endsWith('/submit'))?.body).toEqual({ force: true, style: 'paper-doodle' });
  });

  it('takes a dropped recording for the cut and can hand the voice back to the studio', async () => {
    const Page = (await import('@/app/jobs/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText('New since last pull')).toBeTruthy());
    fireEvent.click(screen.getByTestId('prepare-week'));
    await waitFor(() => expect(screen.getByTestId('own-voice-pick')).toBeTruthy());
    expect(screen.getByText(/Optional\. Drop one recording/)).toBeTruthy();

    const input = screen.getByTestId('own-voice').querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['audio'], 'take.m4a', { type: 'audio/mp4' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(posted.some((p) => p.url.endsWith('/api/jobs/cuts/1/voice?name=take.m4a'))).toBe(true));
    await waitFor(() => expect(screen.getByTestId('own-voice-file')).toBeTruthy());
    expect(screen.getByTestId('own-voice-file').textContent).toContain('take.m4a');

    fireEvent.click(screen.getByTestId('own-voice-clear'));
    await waitFor(() => expect(posted.filter((p) => p.url.endsWith('/api/jobs/cuts/1/voice')).length).toBe(1));
  });

  it('pulls the pool from the button', async () => {
    const Page = (await import('@/app/jobs/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByTestId('pull-now')).toBeTruthy());
    fireEvent.click(screen.getByTestId('pull-now'));
    await waitFor(() => expect(posted.some((p) => p.url.endsWith('/api/jobs/pool/pull'))).toBe(true));
  });
});

describe('the request formats tab', () => {
  it('shows the flow and one card per style from the board', async () => {
    const Page = (await import('@/app/jobs/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Request formats')).toBeTruthy());
    fireEvent.click(screen.getByText('Request formats'));
    await waitFor(() => expect(screen.getByTestId('request-formats')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Paper & Doodle')).toBeTruthy());
    expect(screen.getByText('How a cut becomes a reel')).toBeTruthy();
  });
});


describe('the job card tab', () => {
  const openTab = async () => {
    const Page = (await import('@/app/jobs/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Job card')).toBeTruthy());
    fireEvent.click(screen.getByText('Job card'));
    await waitFor(() => expect(screen.getByTestId('job-card')).toBeTruthy());
  };

  it('opens the pane that holds a card for one job', async () => {
    await openTab();
    expect(screen.getByTestId('jobcard-url')).toBeTruthy();
    expect(screen.getByText(/A reference post decides the look/)).toBeTruthy();
  });

  it('reads a listing, shows the document it read, and renders the card', async () => {
    await openTab();

    fireEvent.change(screen.getByTestId('jobcard-url'), {
      target: { value: 'https://careers.zohocorp.com/jobs/sde' },
    });
    fireEvent.click(screen.getByTestId('jobcard-read'));
    await waitFor(() => expect(posted.some((p) => p.url.endsWith('/api/jobcards'))).toBe(true));
    expect(posted.find((p) => p.url.endsWith('/api/jobcards'))?.body).toMatchObject({
      url: 'https://careers.zohocorp.com/jobs/sde',
    });

    await waitFor(() =>
      expect((screen.getByTestId('jobcard-company') as HTMLInputElement).value).toBe('Zoho Corporation')
    );
    expect((screen.getByTestId('jobcard-salary-min') as HTMLInputElement).value).toBe('8');

    fireEvent.click(screen.getByTestId('jobcard-render'));
    await waitFor(() => expect(posted.some((p) => p.url.endsWith('/render'))).toBe(true));
    await waitFor(() => expect(screen.getByTestId('jobcard-image')).toBeTruthy());
    expect(screen.getByTestId('jobcard-image').getAttribute('src')).toContain('/api/jobcards/zoho-sde-1/image');
  });
});
