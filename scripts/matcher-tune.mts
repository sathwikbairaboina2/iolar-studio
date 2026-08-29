// Compares candidate coverage matchers on the same two measures.
import { loadBook } from '../lib/ai/book';
import { listParts, loadPost } from '../lib/store';
import type { Post } from '../lib/schema';
import type { Book } from '../lib/ai/book';
import { readdirSync, statSync, existsSync } from 'fs';

const STOP_OLD = new Set('the a an and or of to in for with is are its it you your how what why when use using python vs on at be by as that this from can will not no'.split(' '));
const STOP = new Set(('the a an and or of to in for with is are was were be been being its it you your his her their our'
 + ' how what why when where which who whom use uses used using vs versus on at by as that this these those'
 + ' from can could will would should may might must not no nor but if then than so such too very just'
 + ' into onto over under above below between both each all any some more most other same only own now'
 + ' do does did done get gets got make makes made take takes has have had here there while during after'
 + ' before because about across through against per via out up down off again once ever never always'
 + ' one two three first second next last also eg ie etc').split(' '));

const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
const trimE = (w: string) => (w.length >= 5 && w.endsWith('e') ? w.slice(0, -1) : w);
function stem(w: string): string {
  for (const [suf, min] of [['ation', 7], ['ing', 6], ['ed', 5], ['es', 5], ['ly', 5]] as const)
    if (w.length >= min && w.endsWith(suf)) return trimE(w.slice(0, -suf.length));
  if (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss')) return trimE(w.slice(0, -1));
  return trimE(w);
}
const terms = (s: string) => tokens(s).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);

function postText(post: Post): string {
  const out: string[] = [];
  for (const s of post.slides) {
    out.push(s.page_title);
    for (const b of s.blocks as any[]) {
      for (const k of ['text', 'title', 'q']) if (typeof b[k] === 'string') out.push(b[k]);
      for (const k of ['items', 'lines', 'a_bullets', 'example_code']) if (Array.isArray(b[k])) out.push(...b[k]);
      if (b.type === 'table') { out.push(...b.headers); for (const r of b.rows) out.push(...r); }
    }
  }
  return out.join(' ');
}

function df(book: Book) {
  const m = new Map<string, number>();
  let n = 0;
  for (const ch of book.chapters) for (const p of ch.points) { n++; for (const w of new Set(terms(p))) m.set(w, (m.get(w) ?? 0) + 1); }
  return { m, n };
}

type Matcher = (book: Book, post: Post) => Set<string>;

const OLD: Matcher = (book, post) => {
  const body = postText(post).toLowerCase();
  const out = new Set<string>();
  for (const ch of book.chapters) for (const p of ch.points) {
    const kws = (p.toLowerCase().match(/[a-z_][a-z0-9_().]{2,}/g) ?? []).filter((w) => !STOP_OLD.has(w)).slice(0, 6);
    if (!kws.length) continue;
    const hits = kws.filter((w) => body.includes(w.replace(/[().]/g, ''))).length;
    if (hits / kws.length < 0.5) out.add(p);
  }
  return out;
};

const RAREST6: Matcher = (book, post) => {
  const body = new Set(terms(postText(post)));
  const { m } = df(book);
  const out = new Set<string>();
  for (const ch of book.chapters) for (const p of ch.points) {
    const kws = [...new Set(terms(p))].sort((a, b) => (m.get(a) ?? 0) - (m.get(b) ?? 0)).slice(0, 6);
    if (!kws.length) continue;
    if (kws.filter((w) => body.has(w)).length / kws.length < 0.5) out.add(p);
  }
  return out;
};

const idfWeighted = (threshold: number): Matcher => (book, post) => {
  const body = new Set(terms(postText(post)));
  const { m, n } = df(book);
  const out = new Set<string>();
  for (const ch of book.chapters) for (const p of ch.points) {
    const kws = [...new Set(terms(p))];
    if (!kws.length) continue;
    let total = 0, hit = 0;
    for (const w of kws) {
      const weight = Math.log(1 + n / (1 + (m.get(w) ?? 0)));
      total += weight;
      if (body.has(w)) hit += weight;
    }
    if (total > 0 && hit / total < threshold) out.add(p);
  }
  return out;
};

const chapters: string[] = [];
for (const s of readdirSync('data/handbooks')) {
  const sd = `data/handbooks/${s}`;
  if (!statSync(sd).isDirectory()) continue;
  for (const c of readdirSync(sd)) if (existsSync(`${sd}/${c}/book.json`)) chapters.push(`${s}/${c}`);
}

const loaded: { book: Book; full: Post; half: Post; total: number }[] = [];
for (const key of chapters) {
  const [subject, chapter] = key.split('/');
  const book = await loadBook(subject, chapter);
  if (!book) continue;
  const parts = await listParts(subject, chapter);
  const posts = await Promise.all(parts.map((p) => loadPost(subject, chapter, p)));
  const full = { ...posts[0], slides: posts.flatMap((p) => p.slides) } as Post;
  const half = { ...full, slides: full.slides.slice(0, Math.ceil(full.slides.length / 2)) } as Post;
  loaded.push({ book, full, half, total: book.chapters.reduce((n, c) => n + c.points.length, 0) });
}

const variants: [string, Matcher][] = [
  ['old (shipped)', OLD],
  ...[0.34, 0.38, 0.42, 0.44, 0.46, 0.48, 0.52].map(
    (t) => [`idf ${t.toFixed(2)}`, idfWeighted(t)] as [string, Matcher]
  ),
];

for (const [name, matcher] of variants) {
  let points = 0, flagged = 0, detected = 0, present = 0;
  for (const { book, full, half, total } of loaded) {
    const missFull = matcher(book, full);
    const missHalf = matcher(book, half);
    points += total;
    flagged += missFull.size;
    // Points that survived in the full chapter and are correctly reported gone after the cut.
    for (const p of missHalf) if (!missFull.has(p)) detected++;
    present += total - missFull.size;
  }
  console.log(
    `${name.padEnd(14)} false alarms ${String(flagged).padStart(4)}/${points} (${((flagged / points) * 100).toFixed(2)}%)   ` +
    `detected after cut ${detected}/${present} (${((detected / present) * 100).toFixed(1)}%)`
  );
}
