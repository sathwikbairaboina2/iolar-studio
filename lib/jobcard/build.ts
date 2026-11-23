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

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 360) % 360;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t: [number, number, number] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return rgbToHex((t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255);
}

/**
 * One accent per card, and a navy that is that accent taken down and pulled part
 * of the way towards blue — so cards for different companies still read as one
 * series. A company that names its own colour keeps it.
 */
export function coloursFor(card: JobCard): { accent: string; navy: string } {
  let accent = card.company.accent;
  if (!accent) {
    let hash = 0;
    for (const ch of card.company.name.toUpperCase()) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    accent = hslToHex(hash, 0.72, 0.42);
  }
  const [h, s] = rgbToHsl(...hexToRgb(accent));
  const navyHue = h + ((((240 - h + 540) % 360) - 180) * 0.45);
  const navy = hslToHex((navyHue + 360) % 360, Math.max(s * 0.75, 0.45), 0.2);
  return { accent, navy };
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

/** The plain wording of the CTA, and the same wording once for a band that cannot hold markup. */
const CHANNEL: Record<JobCard['cta']['channel'], { rich: string; plain: string }> = {
  site: {
    rich: 'Apply on <b>aiiolar.com</b> &middot; <span class="hi">link in bio</span>',
    plain: 'apply on aiiolar.com, link in bio',
  },
  whatsapp: {
    rich: 'Apply link on our <b>WhatsApp Channel</b> &middot; <span class="hi">link in bio</span>',
    plain: 'apply link on our WhatsApp Channel, link in bio',
  },
  bio: { rich: 'Apply link <b>in our bio</b>', plain: 'apply link in our bio' },
  dm: { rich: '<b>DM us</b> for the apply link', plain: 'DM us for the apply link' },
};

const CURRENCY: Record<string, string> = { INR: '&#8377;', USD: '$', EUR: '&euro;', GBP: '&pound;' };

export type CardView = ReturnType<typeof viewOf>;

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
    /** A headline breaks on its own words, never mid-word, and the last of the first three carries the accent. */
    roleLines: words
      .map((w, i) => (i === words.length - 1 ? `<span class="alt">${esc(w)}</span>` : esc(w)))
      .join('<br>'),
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
    locLine:
      card.location.city.trim().toLowerCase() === MODE[card.location.workMode].toLowerCase()
        ? esc(card.location.city)
        : `${esc(card.location.city)} &middot; ${MODE[card.location.workMode]}`,
    money: pay ? `${sym} ${num(pay.min)} &ndash; ${sym} ${num(pay.max)} ${unit}` : 'Not disclosed',
    moneyShort: pay ? `${sym}${num(pay.min)} &ndash; ${sym}${num(pay.max)} ${unit}` : 'Not disclosed',
    moneyNote: pay?.note ? esc(pay.note) : null,
    eligibility: card.eligibility.map(esc),
    /** The same lines run into one sentence, kept apart so two rules never read as one. */
    eligInline: card.eligibility.map(esc).join(' &middot; '),
    steps: card.selectionProcess.map((s) => ({
      n: s.step,
      label: esc(s.label),
      detail: s.detail ? esc(s.detail) : null,
    })),
    stepLine: card.selectionProcess.map((s) => esc(s.label)).join(' &rarr; '),
    dates: card.dates.map((d) => ({
      lab: DATE_LABEL[d.kind],
      date: esc(d.date),
      time: d.time ? esc(d.time) : null,
      kind: d.kind,
    })),
    deadline: deadline ? esc(deadline.date) : null,
    keyword: esc(card.cta.keyword ?? ''),
    channel: CHANNEL[card.cta.channel].rich,
    channelPlain: CHANNEL[card.cta.channel].plain,
  };
}

/* ---------- shared fragments ---------- */

const COINS = ['c1', 'c2', 'c3', 'c4'];
const icon = (id: string) => `<svg><use href="#i-${id}"/></svg>`;
const coin = (id: string, n = -1, style = '') =>
  `<div class="coin${n >= 0 ? ' ' + COINS[n % 4] : ''}"${style ? ` style="${style}"` : ''}>${icon(id)}</div>`;

const mark = (v: CardView, style = '') =>
  `<div class="mark"${style ? ` style="${style}"` : ''}>${v.logo ? `<img src="${v.logo}" alt="">` : v.initial}</div>`;

const logoBlock = (v: CardView, tail = true) =>
  `<div class="logo">${mark(v)}<div class="word">${v.companyHead}${
    tail && v.companyTail ? `<small>${v.companyTail}</small>` : ''
  }</div></div>`;

const foot = (v: CardView) =>
  `<div class="foot">` +
  `<div class="cell">${icon('link')}<div>${v.channel}</div></div>` +
  `<div class="cell">${icon('chat')}<div>Comment <span class="hi">&ldquo;${v.keyword}&rdquo;</span> if you are interested</div></div>` +
  `</div>`;

const fact = (id: string, n: number, lab: string, val: string) =>
  `<div class="fact">${coin(id, n)}<div><div class="lab">${lab}</div><div class="val">${val}</div></div></div>`;

const COIN_HEX = ['#5B2A86', '#12855A', '#1256B8', '#E2622B'];

/* ---------- the families ---------- */

function splitHero(v: CardView): string {
  return (
    `<div class="hero">${v.logo ? `<img src="${v.logo}" alt="">` : `<div class="mono">${v.initial}</div>`}</div>` +
    `<div class="dots"></div>` +
    `<div class="pad col">` +
    logoBlock(v) +
    `<div class="head">Hiring<br><span class="alt">Now</span></div>` +
    `<div class="badge">${v.exp} <span class="hi">Exp</span></div>` +
    `<div style="margin:22px 0 8px"><span class="pill">${v.role}</span></div>` +
    `<div style="margin-top:14px">` +
    fact('case', 0, 'Skill', v.skillLine) +
    fact('user', 1, 'Experience', v.exp) +
    fact('pin', 2, 'Location', v.modeNote ? `${v.cityRegion} &middot; ${v.modeNote}` : v.cityRegion) +
    fact('rupee', 3, 'Salary Range', v.money) +
    `</div>` +
    `<div class="box" style="margin-top:26px">` +
    coin('cap', 0, 'width:64px;height:64px') +
    `<div><div class="t">Eligibility</div><div class="p">${v.eligInline}</div></div>` +
    `</div></div>` +
    foot(v)
  );
}

function infographic(v: CardView): string {
  const cells = [
    { id: 'user', lab: 'Experience', val: v.exp },
    { id: 'pin', lab: 'Location', val: v.modeNote ? `${v.city}<br>${v.modeNote}` : v.city },
    { id: 'rupee', lab: 'Salary', val: v.moneyShort },
    v.deadline
      ? { id: 'cal', lab: 'Apply before', val: v.deadline }
      : { id: 'clock', lab: 'Work mode', val: v.mode },
  ];
  const rows = [
    { id: 'case', name: 'Core stack', sub: 'Must have', items: v.skills.slice(0, 3), colour: 0 },
    { id: 'cap', name: 'Eligibility', sub: 'Degree &amp; marks', items: v.eligibility.slice(0, 3), colour: 1 },
    ...(v.steps.length
      ? [
          {
            id: 'clock',
            name: 'Selection',
            sub: `${v.steps.length} round${v.steps.length > 1 ? 's' : ''}`,
            items: v.steps.slice(0, 3).map((s) => s.label),
            colour: 2,
          },
        ]
      : []),
  ];

  return (
    `<div class="pad">` +
    `<div class="top">` +
    `<div class="logo" style="flex-direction:column;align-items:flex-start;gap:14px">` +
    mark(v, 'width:96px;height:96px;border-radius:22px;font-size:48px') +
    `<div class="head">${v.roleLines}</div></div>` +
    `<div class="bubble" style="margin-left:auto">${v.mode}<br><span style="color:#ffd400">${v.exp}</span></div>` +
    `</div>` +
    `<div class="ribbon" style="margin-top:30px"><div class="rule"></div><div class="bar">Role details</div><div class="rule"></div></div>` +
    `<div class="strip">` +
    cells
      .map((c, i) => `<div class="c">${coin(c.id, i)}<div class="lab">${c.lab}</div><div class="val">${c.val}</div></div>`)
      .join('') +
    `</div>` +
    `<div class="ribbon"><div class="rule"></div><div class="bar">Skills &amp; eligibility</div><div class="rule"></div></div>` +
    rows
      .map(
        (r) =>
          `<div class="rrow">${coin(r.id, r.colour)}` +
          `<div class="left"><div class="name" style="color:${COIN_HEX[r.colour]}">${r.name}</div><div class="sub">${r.sub}</div></div>` +
          `<ul class="bul">${r.items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`
      )
      .join('') +
    `<div class="notice">` +
    `<svg style="width:38px;height:38px;fill:var(--accent)"><use href="#i-flash"/></svg>` +
    `<div><div class="k">${v.company}</div><div class="v">${v.role}</div></div>` +
    `<div class="tagbox">${v.brand}</div></div>` +
    `</div>` +
    foot(v)
  );
}

function campaign(v: CardView): string {
  const first = v.card.dates[0];
  const headWord = first?.kind === 'walk-in' ? 'Walk-In' : 'Hiring';
  const year = (first?.date.match(/\b(20\d{2})\b/) ?? [])[1] ?? '';
  const eligPanel =
    `<div class="panel"><div class="ph">Who can apply</div><div class="body">` +
    v.eligibility
      .slice(0, 3)
      .map((e, i) => {
        const [head, ...rest] = e.split(/,\s*/);
        return (
          `<div class="erow">${coin(['cap', 'user', 'case'][i % 3], i)}` +
          `<div><div class="n">${head}</div>${rest.length ? `<div class="d">${rest.join(', ')}</div>` : ''}</div></div>`
        );
      })
      .join('') +
    `</div></div>`;
  // A card never prints an empty panel: with no announced rounds the second panel
  // says what the role asks for instead.
  const secondPanel = v.steps.length
    ? `<div class="panel alt"><div class="ph">Selection process</div><div class="body">` +
      v.steps
        .slice(0, 4)
        .map(
          (s, i) =>
            `<div class="erow"><div class="num" style="background:${COIN_HEX[i % 4]}">${s.n}</div>` +
            `<div><div class="n">${s.label}</div>${s.detail ? `<div class="d">${s.detail}</div>` : ''}</div></div>`
        )
        .join('') +
      `</div></div>`
    : `<div class="panel alt"><div class="ph">What the role asks</div><div class="body">` +
      v.skills
        .slice(0, 4)
        .map((s, i) => `<div class="erow">${coin('case', i)}<div><div class="n">${s}</div></div></div>`)
        .join('') +
      `</div></div>`;

  return (
    `<div class="wm">${v.brand}</div>` +
    `<div class="pad">` +
    logoBlock(v, false) +
    `<div class="head">${headWord}<br>Drive${year ? ` <span class="alt">${year}</span>` : ''}</div>` +
    `<div class="tag">${v.role}</div>` +
    `<div class="lede">${v.company} &middot; ${v.cityRegion}${v.modeNote ? ` &middot; ${v.modeNote}` : ''} &middot; ${v.exp}</div>` +
    // The rounds are already spelled out in the panel below; the corner card only
    // earns its space when there is no panel to print them in.
    (!v.steps.length && v.skills.length
      ? `<div class="vis"><div class="t">What it asks for</div>` +
        v.skills
          .slice(0, 3)
          .map((s) => `<div class="ck"><i></i>${s}</div>`)
          .join('') +
        `</div>`
      : '') +
    (v.dates.length
      ? `<div class="dates">` +
        v.dates
          .slice(0, 2)
          .map(
            (d, i) =>
              `<div class="c">${coin(i === 0 ? 'cal' : 'clock', -1, `width:64px;height:64px;background:${i === 0 ? v.navy : v.accent}`)}` +
              `<div><div class="lab">${d.lab}</div><div class="val">${d.date}${d.time ? `<small>${d.time}</small>` : ''}</div></div></div>`
          )
          .join('') +
        `</div>`
      : '') +
    `<div class="panels">${eligPanel}${secondPanel}</div>` +
    `<div class="money">${coin('rupee', -1, `background:${v.accent}`)}` +
    `<div><div class="lab">Salary range</div><div class="big">${v.money}</div>` +
    (v.moneyNote ? `<div class="note">${v.moneyNote}</div>` : '') +
    `</div><div class="sk"><div class="lab">Skills</div><div class="v">${v.skillLine}</div></div></div>` +
    `</div>` +
    foot(v)
  );
}

function bento(v: CardView): string {
  return (
    `<div class="pad">` +
    `<div class="bar">${logoBlock(v, false)}<div class="tag">${v.brand}</div></div>` +
    `<div class="grid">` +
    `<div class="t hero"><div class="r">${v.role}</div><div class="c">${v.company} &middot; hiring now</div></div>` +
    `<div class="t">${coin('user', 2)}<div class="lab">Experience</div><div class="val">${v.exp}</div></div>` +
    `<div class="t">${coin('pin', 0)}<div class="lab">Location</div><div class="val">${v.city}${v.modeNote ? `<br>${v.modeNote}` : ''}</div></div>` +
    `<div class="t">${coin('rupee', 1)}<div class="lab">Salary</div><div class="val">${v.moneyShort}</div></div>` +
    `<div class="t wide"><div class="lab">Skills</div><div class="chips">${v.skills
      .map((s) => `<span class="chip">${s}</span>`)
      .join('')}</div></div>` +
    `<div class="t wide"><div class="lab">Eligibility</div><div class="p">${v.eligInline}</div></div>` +
    (v.steps.length
      ? `<div class="t wide"><div class="lab">Selection process</div><div class="p">${v.stepLine}</div></div>`
      : `<div class="t wide"><div class="lab">How to apply</div><div class="p">Comment &ldquo;${v.keyword}&rdquo; &middot; ${v.channelPlain}</div></div>`) +
    `</div></div>` +
    foot(v)
  );
}

function ticket(v: CardView): string {
  return (
    `<div class="tk">` +
    `<div class="tkhead">${mark(v)}<div class="n">${v.companyHead}</div><div class="k">Hiring pass</div></div>` +
    `<div class="tkbody">` +
    `<div class="role">${v.role}</div>` +
    `<div class="co">${v.company}${v.team ? ` &middot; ${v.team}` : ''}</div>` +
    `<div class="g">` +
    `<div><div class="lab">Experience</div><div class="val">${v.exp}</div></div>` +
    `<div><div class="lab">Location</div><div class="val">${v.locLine}</div></div>` +
    `<div><div class="lab">Skill</div><div class="val">${v.skills.slice(0, 3).join(', ')}</div></div>` +
    (v.steps.length
      ? `<div><div class="lab">Selection</div><div class="val">${v.stepLine}</div></div>`
      : `<div><div class="lab">Work mode</div><div class="val">${v.mode}</div></div>`) +
    `</div>` +
    `<div class="elig"><b>Eligibility:</b> ${v.eligInline}</div>` +
    `</div>` +
    `<div class="perf"></div>` +
    `<div class="stub">` +
    `<div><div class="lab">Salary range</div><div class="big">${v.moneyShort}</div></div>` +
    `<div><div class="lab">${v.deadline ? 'Apply before' : 'Applications'}</div><div class="mid">${
      v.deadline ?? 'Open now'
    }</div></div>` +
    `<div class="bars"></div>` +
    `</div>` +
    `<div class="cta">${icon('chat')}<div>Comment <span class="hi">&ldquo;${v.keyword}&rdquo;</span> &middot; ${v.channelPlain}</div></div>` +
    `</div>`
  );
}

function bandStack(v: CardView): string {
  const band = (k: string, val: string, small?: string | null, cls = '') =>
    `<div class="band${cls ? ' ' + cls : ''}"><div class="k">${k}</div><div class="v">${val}${
      small ? `<small>${small}</small>` : ''
    }</div></div>`;

  return (
    `<div class="b-head">` +
    `<div class="logo">${mark(v)}<div class="word" style="color:#fff">${v.companyHead}</div></div>` +
    `<div class="h">${v.role}</div>` +
    `<div class="s">${v.company} &middot; ${v.cityRegion}${v.deadline ? ` &middot; apply before ${v.deadline}` : ''}</div>` +
    `</div>` +
    band('Skill', v.skills.slice(0, 4).join(', '), v.skills.slice(4).join(', ') || null) +
    band('Experience', v.exp) +
    band('Location', v.cityRegion, v.modeNote) +
    band('Salary range', v.money, v.moneyNote, 'b-tint b-money') +
    band('Eligibility', v.eligibility[0] ?? '', v.eligibility.slice(1).join(' &middot; ') || null) +
    (v.steps.length
      ? band(
          'Selection process',
          `<div class="steps">${v.steps
            .map((s) => `<span class="step">${s.n} &middot; ${s.label}</span>`)
            .join('')}</div>`
        )
      : '') +
    band(
      'How to apply',
      `Comment <b style="color:#ffd400">&ldquo;${v.keyword}&rdquo;</b> &middot; ${v.channelPlain}`,
      null,
      'b-dark'
    )
  );
}

const FAMILY_HTML: Record<Family, (v: CardView) => string> = {
  'split-hero': splitHero,
  infographic,
  campaign,
  bento,
  ticket,
  'band-stack': bandStack,
};

/* ---------- the page ---------- */

/**
 * The family's own `template.html` is the shell: it carries that family's rules and
 * two markers. The head gets the shared vocabulary and this card's three colours;
 * the body gets the icon sprite and the family's arrangement of the slots.
 */
export function buildCardHtml(card: JobCard, family: Family, opts: { brand?: string } = {}): string {
  const v = viewOf(card, opts.brand ?? 'iolar');
  const [w, h] = ratioFor(family);
  const shell = readFileSync(path.join(jobcardRoot(), family, 'template.html'), 'utf8');

  const head =
    `<link rel="stylesheet" href="../_shared/card.css">` +
    `<style>:root{--w:${w}px;--h:${h}px}#card{--accent:${v.accent};--navy:${v.navy}}</style>`;

  const body = `${SPRITE}<div id="card" class="${family}">${FAMILY_HTML[family](v)}</div>`;

  return shell.replace('<!--HEAD-->', head).replace('<!--CARD-->', body);
}
