import type { PanelJob } from '@/lib/jobcard/panelJob';

/** A panel job as the control room sends it: fixed fields plus the variable `attrs`. */
export const panelJob = (over: Partial<PanelJob> & { attrs?: PanelJob['attrs'] } = {}): PanelJob => ({
  id: 'job_zoho_sde',
  source: 'aiiolar',
  sourceRef: 'zoho|sde',
  sourceUrl: 'https://aiiolar.com/jobs?job=zoho%7Csde',
  company: 'Zoho Corporation',
  role: 'Software Development Engineer',
  city: 'Chennai',
  region: 'Tamil Nadu',
  workMode: 'hybrid',
  experience: { label: '2 - 5 Years', min: 2, max: 5 },
  salary: { min: 8, max: 18, unit: 'LPA', currency: 'INR' },
  applyUrl: 'https://aiiolar.com/jobs?job=zoho%7Csde',
  originalUrl: 'https://careers.zohocorp.com/jobs/sde',
  status: 'ready',
  firstSeen: '2026-11-20T06:00:00.000Z',
  attrs: {
    skills: ['Java 17', 'Spring Boot', 'MySQL'],
    eligibility: ['B.E. / B.Tech / MCA', 'No active backlogs'],
    rounds: ['Online assessment', { label: 'Technical round 1', detail: 'DSA & fundamentals' }, 'HR discussion'],
    dates: [{ kind: 'deadline', date: '12 December 2026', time: 'Registration closes 6 PM' }],
    familyKey: 'zoho|sde',
  },
  ...over,
});

/** A job the panel scraped: nothing but the fixed facts. */
export const sparseJob = (over: Partial<PanelJob> = {}): PanelJob =>
  panelJob({
    id: 'job_sparse',
    source: 'scraper',
    sourceRef: 'C1abc',
    sourceUrl: 'https://www.instagram.com/p/C1abc/',
    company: 'Freshworks',
    role: 'Support Engineer',
    city: 'Chennai',
    region: null,
    workMode: 'onsite',
    experience: { label: '0 - 2 Years', min: 0, max: 2 },
    salary: null,
    applyUrl: 'https://aiiolar.com/jobs?q=Support%20Engineer%20Freshworks',
    originalUrl: null,
    attrs: { skills: [], eligibility: [], rounds: [], dates: [] },
    ...over,
  });
