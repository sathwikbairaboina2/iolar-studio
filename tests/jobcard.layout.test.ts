import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { chromium } from 'playwright';
import { FAMILIES, parseJobCard, type Family, type JobCard } from '@/lib/jobcard/schema';
import { buildCardHtml, jobcardRoot } from '@/lib/jobcard/build';
import { renderFamily, closeBrowser } from '@/lib/jobcard/render';

const full = parseJobCard(
  JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/jobcard.json'), 'utf8'))
);

const minimal = (over: Partial<Record<string, unknown>> = {}) =>
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
    ...over,
  });

const remote = () => minimal({ location: { city: 'Remote', region: null, workMode: 'remote' } });
const withDate = (kind: 'drive' | 'walk-in', date: string): JobCard => ({
  ...full,
  dates: [{ kind, date, time: null }, ...full.dates.slice(1)],
});

/** What a viewer reads: no markup, no stylesheet, no icon sprite, no document title. */
function bodyText(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<\/(div|li)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '.');
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

afterAll(async () => {
  await closeBrowser();
});

describe('campaign headline', () => {
  it('says Now Hiring, not Drive, for a job with no drive or walk-in', () => {
    for (const c of [minimal(), full]) {
      const t = bodyText(buildCardHtml(c, 'campaign'));
      expect(t).toContain('Now');
      expect(t).toContain('Hiring');
      expect(t).not.toContain('Drive');
    }
  });

  it('says Hiring Drive and the year for a drive date', () => {
    const html = buildCardHtml(withDate('drive', '20 September 2026'), 'campaign');
    expect(html).toMatch(/<div class="head">Hiring<br>Drive <span class="alt">2026<\/span><\/div>/);
  });

  it('says Walk-In Drive for a walk-in date', () => {
    const html = buildCardHtml(withDate('walk-in', '20 September 2026'), 'campaign');
    expect(html).toMatch(/<div class="head">Walk-In<br>Drive <span class="alt">2026<\/span><\/div>/);
  });
});

describe('every fact once', () => {
  const cases: [string, JobCard][] = [
    ['full', full],
    ['minimal', minimal()],
    ['remote', remote()],
  ];

  it.each(FAMILIES.flatMap((f) => cases.map(([n, c]) => [f, n, c] as [Family, string, JobCard])))(
    '%s / %s states each fact in one place',
    (family, _name, c) => {
      const t = bodyText(buildCardHtml(c, family));
      const shownSkills = family === 'infographic' ? c.role.skills.slice(0, 3) : c.role.skills;
      for (const s of shownSkills) expect(count(t, s), `skill ${s}`).toBe(1);
      expect(count(t, c.experience.label), 'experience').toBe(1);
      expect(count(t, c.company.name), 'company').toBe(1);
      expect(count(t, c.role.title), 'role').toBe(1);
      expect(count(t, '@aiiolar'), 'handle').toBe(1);
      const mode = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' }[c.location.workMode];
      expect(count(t, mode), 'work mode').toBe(1);
      if (c.salary) expect(count(t, 'LPA'), 'salary').toBe(1);
      else expect(count(t, 'Not disclosed'), 'salary').toBe(1);
      for (const e of c.eligibility.slice(0, 3)) expect(count(t, e.split(/,\s*/)[0]), `eligibility ${e}`).toBe(1);
      for (const s of c.selectionProcess.slice(0, 3)) expect(count(t, s.label), `round ${s.label}`).toBe(1);
      for (const d of c.dates.slice(0, 2)) {
        if (family === 'infographic' && d.kind !== 'deadline') continue;
        expect(count(t, d.date), `date ${d.date}`).toBe(1);
      }
    }
  );
});

describe('campaign without rounds', () => {
  it('has no corner box, lists skills once and prints a glance strip instead of dates and money', () => {
    const html = buildCardHtml(minimal(), 'campaign');
    expect(html).not.toContain('class="vis"');
    expect(html).not.toContain('What it asks for');
    expect(html).toContain('class="glance"');
    expect(html).not.toContain('class="dates"');
    expect(html).not.toContain('class="money"');
    expect(html).not.toContain('What the role asks');
  });

  it('drops the work mode cell when the city is the work mode', () => {
    const html = buildCardHtml(remote(), 'campaign');
    expect(html).toContain('class="glance"');
    expect((html.match(/class="g"/g) ?? []).length).toBe(3);
  });

  it('keeps the dates strip and money row when the job has dates', () => {
    const html = buildCardHtml(full, 'campaign');
    expect(html).toContain('class="dates"');
    expect(html).toContain('class="money"');
    expect(html).not.toContain('class="glance"');
  });
});

describe('infographic', () => {
  it('has no notice box', () => {
    for (const c of [full, minimal()]) expect(buildCardHtml(c, 'infographic')).not.toContain('class="notice"');
  });

  it('puts the deadline in the bubble, or Now hiring', () => {
    expect(bodyText(buildCardHtml(full, 'infographic'))).toContain('Apply by 12 September 2026');
    const none = bodyText(buildCardHtml(minimal(), 'infographic'));
    expect(none).toContain('Now hiring');
    expect(none).not.toContain('Apply by');
  });

  it('ends a cut list with "+N more"', () => {
    const t = bodyText(buildCardHtml(full, 'infographic'));
    expect(t).toContain('+2 more');
    expect(t).toContain('+1 more');
  });

  it('wraps the title on its own words and keeps the last one as the accent', () => {
    const html = buildCardHtml(full, 'infographic');
    expect(html).toMatch(/Software Development <span class="alt">Engineer<\/span>/);
    expect(html).not.toMatch(/class="head[^"]*">[^<]*<br>/);
  });

  it('keeps work mode and experience out of the bubble', () => {
    const html = buildCardHtml(full, 'infographic');
    const bubble = html.match(/<div class="bubble"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(bubble).not.toContain('Hybrid');
    expect(bubble).not.toContain('Years');
  });

  it('drops the work mode cell when the city is the work mode', () => {
    const html = buildCardHtml(remote(), 'infographic');
    expect((html.match(/class="c"/g) ?? []).length).toBe(3);
  });
});

describe('the cards fit and have no dead band', () => {
  const out = (n: string) => path.join(tmpdir(), `iolar-layout-${n}-${Date.now()}.png`);

  it('the full job holds in the infographic and the campaign', async () => {
    for (const family of FAMILIES) {
      const r = await renderFamily(full, family, out(`full-${family}`));
      expect(r.overflowPx, `${family} overflow`).toBe(0);
      expect(r.slackPx, `${family} slack`).toBeLessThanOrEqual(140);
      console.log('full', family, 'overflowPx', r.overflowPx, 'slackPx', r.slackPx);
    }
  }, 180_000);

  it('a scraped-style job fills both families', async () => {
    for (const c of [minimal(), remote()]) {
      for (const family of FAMILIES) {
        const r = await renderFamily(c, family, out(`min-${family}`));
        expect(r.overflowPx, `${family} overflow`).toBe(0);
        expect(r.slackPx, `${family} slack`).toBeLessThanOrEqual(140);
        console.log('minimal', c.location.city, family, 'overflowPx', r.overflowPx, 'slackPx', r.slackPx);
      }
    }
  }, 180_000);

  it('the watermark and the bubble do not overlap in the infographic', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const c of [full, minimal(), remote()]) {
        const tmp = path.join(jobcardRoot(), 'infographic', `.overlap-${process.pid}-${Date.now()}.html`);
        await fs.writeFile(tmp, buildCardHtml(c, 'infographic'));
        const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
        try {
          await page.goto('file://' + tmp.replace(/\\/g, '/'));
          await page.evaluate(() => document.fonts.ready);
          const hit = await page.evaluate(() => {
            const a = document.querySelector('.wm')?.getBoundingClientRect();
            const b = document.querySelector('.bubble')?.getBoundingClientRect();
            if (!a || !b) return null;
            return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          });
          expect(hit, 'both boxes exist').not.toBeNull();
          expect(hit, 'wm overlaps bubble').toBe(false);
        } finally {
          await page.close();
          await fs.unlink(tmp).catch(() => {});
        }
      }
    } finally {
      await browser.close();
    }
  }, 180_000);
});
