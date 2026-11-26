import { readFileSync } from 'fs';
import path from 'path';
import { Family, JobCard, ratioFor } from './schema';
import { SPRITE } from './icons';

/**
 * A document becomes a card here. Every family is fed the same view — the fields
 * a job card is allowed to say, already worded — and arranges the slots it has a
 * place for. A family never reaches into the document itself, so a field that
 * changes shape changes in one place.
 */

export const jobcardRoot = () => path.join(process.cwd(), 'templates', '_jobcard');

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- colour ---------- */

/** The handle every job card prints; the global `brand` setting belongs to the reel formats. */
export const JOBCARD_BRAND = 'aiiolar';

/**
 * Every card is aiiolar's own magenta and ink; the company's colour no longer tints
 * it, so a set of cards reads as one series. The gradient and the deep band come
 * from the stylesheet.
 */
export function coloursFor(_card: JobCard): { accent: string; navy: string } {
  return { accent: '#b0136e', navy: '#1b1530' };
}

/* ---------- the view every family reads ---------- */

const MODE: Record<JobCard['location']['workMode'], string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

const DATE_LABEL: Record<JobCard['dates'][number]['kind'], string> = {
  'walk-in': 'Walk-in',
  deadline: 'Apply before',
  test: 'Test date',
  drive: 'Drive date',
};

/** The wording of the CTA, with the markup the footer band sets it in. */
const CHANNEL: Record<JobCard['cta']['channel'], string> = {
  site: 'Apply on <b>aiiolar.com</b> &middot; <span class="hi">link in bio</span>',
  whatsapp: 'Apply link on our <b>WhatsApp Channel</b> &middot; <span class="hi">link in bio</span>',
  bio: 'Apply link <b>in our bio</b>',
  dm: '<b>DM us</b> for the apply link',
};

/** The same channels as one apply step, in the card's own wording. */
const CHANNEL_STEP: Record<JobCard['cta']['channel'], string> = {
  site: 'Apply on aiiolar.com',
  whatsapp: 'Open our WhatsApp channel',
  bio: 'Tap the link in our bio',
  dm: 'Send us a DM',
};

const CURRENCY: Record<string, string> = { INR: '&#8377;', USD: '$', EUR: '&euro;', GBP: '&pound;' };

export type CardView = ReturnType<typeof viewOf>;

type ApplyStep = { n: number; label: string; short: string; detail: string | null };

function applySteps(card: JobCard, deadline: string | null): ApplyStep[] {
  const kw = esc(card.cta.keyword ?? '').trim();
  const label = CHANNEL_STEP[card.cta.channel];
  const steps: Omit<ApplyStep, 'n'>[] = [
    ...(kw
      ? [
          { label: `Comment &ldquo;${kw}&rdquo;`, short: `Comment &ldquo;${kw}&rdquo;`, detail: 'on this post' },
          { label: 'Get the link in your DMs', short: 'Get the link in DM', detail: 'we send it to you' },
        ]
      : []),
    {
      label,
      short: label,
      detail: card.cta.channel === 'site' ? (deadline ? `before ${deadline}` : 'the full listing is there') : null,
    },
  ];
  return steps.map((s, i) => ({ n: i + 1, ...s }));
}

export function viewOf(card: JobCard, brand: string) {
  const { accent, navy } = coloursFor(card);
  // Pay nobody announced reads "Not disclosed" everywhere; `salary` is never touched when absent.
  const pay = card.salary ?? null;
  const sym = pay ? (CURRENCY[pay.currency.toUpperCase()] ?? `${esc(pay.currency)} `) : '';
  const unit = pay ? esc(pay.unit) : '';
  const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const deadline = card.dates.find((d) => d.kind === 'deadline') ?? null;
  const words = card.role.title.split(/\s+/);
  const nameWords = card.company.name.split(/\s+/);

  return {
    card,
    accent,
    navy,
    brand: `@${brand}`,
    initial: esc((card.company.name.trim()[0] ?? '?').toUpperCase()),
    /** A logo is read off disk, never fetched: the renderer runs with no network. */
    logo: card.company.logo
      ? 'file://' + path.resolve(process.cwd(), card.company.logo.src).replace(/\\/g, '/')
      : null,
    company: esc(card.company.name),
    /** "Zoho Corporation" sets as a mark word with its tail under it; a one-word name has no tail. */
    companyHead: esc(nameWords[0]),
    companyTail: nameWords.length > 1 ? esc(nameWords.slice(1).join(' ')) : null,
    role: esc(card.role.title),
    /** A headline wraps on its own words; the last one carries the accent. */
    roleWrapped: words
      .map((w, i) => (i === words.length - 1 ? `<span class="alt">${esc(w)}</span>` : esc(w)))
      .join(' '),
    team: card.role.team ? esc(card.role.team) : null,
    skills: card.role.skills.map(esc),
    skillLine: esc(card.role.skills.join(', ')),
    exp: esc(card.experience.label),
    city: esc(card.location.city),
    cityRegion: esc([card.location.city, card.location.region].filter(Boolean).join(', ')),
    mode: MODE[card.location.workMode],
    /**
     * A remote job in the city "Remote" says the same word twice; the second one is
     * dropped so no card reads "Remote / Remote".
     */
    modeNote: card.location.city.trim().toLowerCase() === MODE[card.location.workMode].toLowerCase()
      ? null
      : MODE[card.location.workMode],
    money: pay ? `${sym} ${num(pay.min)} &ndash; ${sym} ${num(pay.max)} ${unit}` : 'Not disclosed',
    moneyShort: pay ? `${sym}${num(pay.min)} &ndash; ${sym}${num(pay.max)} ${unit}` : 'Not disclosed',
    moneyNote: pay?.note ? esc(pay.note) : null,
    eligibility: card.eligibility.map(esc),
    steps: card.selectionProcess.map((s) => ({
      n: s.step,
      label: esc(s.label),
      detail: s.detail ? esc(s.detail) : null,
    })),
    dates: card.dates.map((d) => ({
      lab: DATE_LABEL[d.kind],
      date: esc(d.date),
      time: d.time ? esc(d.time) : null,
      kind: d.kind,
    })),
    deadline: deadline ? esc(deadline.date) : null,
    keyword: esc(card.cta.keyword ?? ''),
    channel: CHANNEL[card.cta.channel],
    /**
     * How to apply, for a card with no announced rounds: comment, get the link in the
     * DM, then the channel. A step whose data is missing is skipped, and nothing
     * promises a reply time.
     */
    applySteps: applySteps(card, deadline ? esc(deadline.date) : null),
  };
}

/* ---------- shared fragments ---------- */

const COINS = ['c1', 'c2', 'c3', 'c4'];
/** The coin palette as the stylesheet defines it, for text and fills a class cannot reach. */
const COIN_VAR = ['var(--coin1)', 'var(--coin2)', 'var(--coin3)', 'var(--coin4)'];
const icon = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
const coin = (id: string, n = -1, style = '') =>
  `<div class="coin${n >= 0 ? ' ' + COINS[n % 4] : ''}"${style ? ` style="${style}"` : ''}>${icon(id)}</div>`;

const mark = (v: CardView, style = '') =>
  `<div class="mark"${style ? ` style="${style}"` : ''}>${v.logo ? `<img src="${v.logo}" alt="">` : v.initial}</div>`;

const logoBlock = (v: CardView, tail = true) =>
  `<div class="logo">${mark(v)}<div class="word">${v.companyHead}${
    tail && v.companyTail ? `<small>${v.companyTail}</small>` : ''
  }</div></div>`;

const chipList = (items: string[]) => `<div class="chips">${items.map((i) => `<span class="chip">${i}</span>`).join('')}</div>`;

const foot = (v: CardView) =>
  `<div class="foot">` +
  `<div class="cell">${icon('link')}<div>${v.channel}</div></div>` +
  `<div class="cell">${icon('chat')}<div>Comment <span class="hi">&ldquo;${v.keyword}&rdquo;</span> if you are interested</div></div>` +
  `</div>`;

/* ---------- the families ---------- */

/** A cut list ends with how many it left out, as its own last item. */
const more = (n: number) => (n > 0 ? [`+${n} more`] : []);

function infographic(v: CardView): string {
  const cells = [
    { id: 'user', lab: 'Experience', val: v.exp },
    { id: 'pin', lab: 'Location', val: v.cityRegion },
    { id: 'rupee', lab: 'Salary', val: v.moneyShort },
    ...(v.modeNote ? [{ id: 'clock', lab: 'Work mode', val: v.modeNote }] : []),
  ];
  const skills = [...v.skills.slice(0, 3), ...more(v.skills.length - 3)];
  const rounds = [...v.steps.slice(0, 3).map((s) => s.label), ...more(v.steps.length - 3)];
  const elig = [...v.eligibility.slice(0, 3), ...more(v.eligibility.length - 3)];
  const rows = [
    { id: 'case', name: 'Core stack', sub: 'Must have', body: chipList(skills), colour: 0 },
    { id: 'cap', name: 'Eligibility', sub: 'Degree &amp; marks', body: `<ul>${elig.map((i) => `<li>${i}</li>`).join('')}</ul>`, colour: 1 },
    ...(v.steps.length
      ? [
          {
            id: 'clock',
            name: 'Selection',
            sub: `${v.steps.length} round${v.steps.length > 1 ? 's' : ''}`,
            body: chipList(rounds),
            colour: 2,
          },
        ]
      : [
          {
            id: 'chat',
            name: 'How to apply',
            sub: `${v.applySteps.length} step${v.applySteps.length > 1 ? 's' : ''}`,
            body: chipList(v.applySteps.map((a) => a.short)),
            colour: 2,
          },
        ]),
  ];
  // A long title sets a size smaller so it wraps to two lines, not three.
  const small = v.card.role.title.length > 22;

  return (
    `<div class="wm">${v.brand}</div>` +
    `<div class="pad">` +
    `<div class="top">` +
    `<div class="logo">${mark(v, 'width:80px;height:80px;border-radius:20px;font-size:40px')}<div class="word">${v.company}</div></div>` +
    `<div class="bubble">${v.deadline ? `Apply by<br>${v.deadline}` : 'Now<br>hiring'}</div>` +
    `</div>` +
    `<div class="head${small ? ' sm' : ''}">${v.roleWrapped}</div>` +
    `<div class="ribbon"><div class="rule"></div><div class="bar">Role details</div><div class="rule"></div></div>` +
    `<div class="strip">` +
    cells
      .map((c, i) => `<div class="c">${coin(c.id, i)}<div class="lab">${c.lab}</div><div class="val">${c.val}</div></div>`)
      .join('') +
    `</div>` +
    `<div class="ribbon"><div class="rule"></div><div class="bar">Skills &amp; eligibility</div><div class="rule"></div></div>` +
    `<div class="rows">` +
    rows
      .map(
        (r) =>
          `<div class="rrow">${coin(r.id, r.colour)}` +
          `<div class="left"><div class="name" style="color:${COIN_VAR[r.colour]}">${r.name}</div><div class="sub">${r.sub}</div></div>` +
          `<div class="bul">${r.body}</div></div>`
      )
      .join('') +
    `</div>` +
    `</div>` +
    foot(v)
  );
}

function campaign(v: CardView): string {
  const drive = v.card.dates.find((d) => d.kind === 'drive');
  const event = drive ?? v.card.dates.find((d) => d.kind === 'walk-in');
  const year = (event?.date.match(/\b(20\d{2})\b/) ?? [])[1] ?? '';
  // Only a job that announced a drive or a walk-in is called one.
  const headline = event
    ? `${drive ? 'Hiring' : 'Walk-In'}<br>Drive${year ? ` <span class="alt">${year}</span>` : ''}`
    : 'Now<br><span class="alt">Hiring</span>';
  // With no dates the card's facts print as a glance strip and the lede is only the company.
  const glance = !v.dates.length;
  const noRounds = !v.steps.length;
  // Who can apply: the eligibility lines, then (with no rounds) the skills, four rows at most.
  const people = noRounds
    ? [
        ...v.eligibility.slice(0, 4).map((e) => {
          const [head, ...rest] = e.split(/,\s*/);
          return { icon: 'elig', head, detail: rest.join(', ') };
        }),
        ...v.skills.map((k) => ({ icon: 'case', head: k, detail: 'Must have' })),
      ].slice(0, 4)
    : v.eligibility.slice(0, 3).map((e) => {
        const [head, ...rest] = e.split(/,\s*/);
        return { icon: 'elig', head, detail: rest.join(', ') };
      });
  const eligPanel =
    `<div class="panel"><div class="ph">Who can apply</div><div class="body">` +
    people
      .map(
        (p, i) =>
          `<div class="erow">${coin(p.icon === 'case' ? 'case' : ['cap', 'user', 'case'][i % 3], i)}` +
          `<div><div class="n">${p.head}</div>${p.detail ? `<div class="d">${p.detail}</div>` : ''}</div></div>`
      )
      .join('') +
    `</div></div>`;
  const numbered = (items: { n: number | string; label: string; detail: string | null }[]) =>
    items
      .map(
        (s, i) =>
          `<div class="erow"><div class="num" style="background:${COIN_VAR[i % 4]}">${s.n}</div>` +
          `<div><div class="n">${s.label}</div>${s.detail ? `<div class="d">${s.detail}</div>` : ''}</div></div>`
      )
      .join('');
  // A card never prints an empty panel: with no announced rounds the second panel
  // says how to apply instead.
  const secondPanel = `<div class="panel alt"><div class="ph">${noRounds ? 'How to apply' : 'Selection process'}</div><div class="body">${
    noRounds ? numbered(v.applySteps) : numbered(v.steps.slice(0, 4))
  }</div></div>`;

  const glanceCells = [
    { id: 'user', lab: 'Experience', val: v.exp },
    { id: 'pin', lab: 'Location', val: v.cityRegion },
    ...(v.modeNote ? [{ id: 'clock', lab: 'Work mode', val: v.modeNote }] : []),
    { id: 'rupee', lab: 'Salary', val: v.moneyShort },
  ];
  // The logo word is the company's first word; the lede carries the full name when there is a tail.
  const lede = glance
    ? [v.companyTail ? v.company : null, v.team]
    : [v.companyTail ? v.company : null, v.cityRegion, v.modeNote, v.exp];
  const ledeParts = lede.filter(Boolean);
  const rowCount = Math.max(people.length, noRounds ? v.applySteps.length : Math.min(v.steps.length, 4));

  return (
    `<div class="wm">${v.brand}</div>` +
    `<div class="pad${rowCount <= 2 ? ' roomy' : rowCount === 3 ? ' mid' : ''}">` +
    logoBlock(v, false) +
    `<div class="head">${headline}</div>` +
    `<div class="tag">${v.role}</div>` +
    (ledeParts.length ? `<div class="lede">${ledeParts.join(' &middot; ')}</div>` : '') +
    (glance
      ? `<div class="glance">` +
        glanceCells
          .map(
            (c, i) =>
              `<div class="g">${coin(c.id, i)}<div><div class="lab">${c.lab}</div><div class="val">${c.val}</div></div></div>`
          )
          .join('') +
        `</div>`
      : `<div class="dates">` +
        v.dates
          .slice(0, 2)
          .map(
            (d, i) =>
              `<div class="c">${coin(i === 0 ? 'cal' : 'clock', -1, `width:64px;height:64px;background:${i === 0 ? v.navy : v.accent}`)}` +
              `<div><div class="lab">${d.lab}</div><div class="val">${d.date}${d.time ? `<small>${d.time}</small>` : ''}</div></div></div>`
          )
          .join('') +
        `</div>`) +
    `<div class="panels">${eligPanel}${secondPanel}</div>` +
    // The salary already sits in the glance strip; the skills already sit in the second panel.
    (glance
      ? ''
      : `<div class="money">${coin('rupee', -1, `background:${v.accent}`)}` +
        `<div><div class="lab">Salary range</div><div class="big">${v.money}</div>` +
        (v.moneyNote ? `<div class="note">${v.moneyNote}</div>` : '') +
        `</div>` +
        (v.steps.length ? `<div class="sk"><div class="lab">Skills</div><div class="v">${v.skillLine}</div></div>` : '') +
        `</div>`) +
    `</div>` +
    foot(v)
  );
}

const FAMILY_HTML: Record<Family, (v: CardView) => string> = {
  infographic,
  campaign,
};

/* ---------- the page ---------- */

/**
 * The family's own `template.html` is the shell: it carries that family's rules and
 * two markers. The head gets the shared vocabulary and this card's three colours;
 * the body gets the icon sprite and the family's arrangement of the slots.
 */
export function buildCardHtml(card: JobCard, family: Family, opts: { brand?: string } = {}): string {
  const v = viewOf(card, opts.brand ?? JOBCARD_BRAND);
  const [w, h] = ratioFor(family);
  const shell = readFileSync(path.join(jobcardRoot(), family, 'template.html'), 'utf8');

  const head =
    `<link rel="stylesheet" href="../_shared/card.css">` +
    `<style>:root{--w:${w}px;--h:${h}px}#card{--accent:${v.accent};--navy:${v.navy}}</style>`;

  const body = `${SPRITE}<div id="card" class="${family}">${FAMILY_HTML[family](v)}</div>`;

  return shell.replace('<!--HEAD-->', head).replace('<!--CARD-->', body);
}
