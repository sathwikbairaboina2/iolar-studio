import { categoryOf, isCover, isItemChapter } from '../handbookCategories';
import type { Finding } from './gates';

type BookLike = { title: string; chapters: { title: string; points: string[]; shape?: string[] }[] };
type SlideLike = { blocks: { type: string; text?: string; q?: string }[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\bs\b/g, '').trim();

const finding = (rule: string, summary: string, evidence: string, fix: string, page = 0): Finding =>
  ({ pass: 'category', rule: `category.${rule}`, severity: 'major', page, summary, evidence, fix });

/**
 * Book-level rules every category shares, and the count rule where the category has one. They
 * catch the padding the source channel shipped: a repeated concept to reach "10", a cover count
 * the pages never deliver.
 */
export function bookGates(book: BookLike, category: string | undefined): Finding[] {
  const out: Finding[] = [];
  const titles = new Map<string, number>();
  book.chapters.forEach((c, i) => {
    const k = norm(c.title);
    if (titles.has(k)) {
      out.push(finding('duplicate-title', `Page ${i + 1} repeats the title of page ${titles.get(k)! + 1}.`, c.title, 'Merge the two pages or give the second its own topic.'));
    } else titles.set(k, i);
  });

  const items = new Map<string, number>();
  book.chapters.forEach((c, i) => !isCover(c) && c.points.forEach((p) => {
    const k = norm(p);
    if (k.length < 8) return; // "Yes", "O(1)": too short to call a repeat
    const first = items.get(k);
    if (first !== undefined && first !== i) {
      out.push(finding('duplicate-item', `An item on page ${i + 1} repeats one from page ${first + 1}.`, p, 'Teach it once; give the later page new material.'));
    } else if (first === undefined) items.set(k, i);
  }));

  // Where items are counted, a page holds `pointsPerPage` of them. One more lands alone on a
  // near-empty page, and condense may not merge items to pull it back.
  const { content, presentation } = categoryOf(category);
  if (content.countBy === 'items') {
    book.chapters.forEach((c, i) => {
      if (isItemChapter(category, c, book.chapters) && c.points.length > presentation.pointsPerPage) {
        out.push(finding('capacity', `Page ${i + 1} ("${c.title}") has ${c.points.length} items, but a page holds ${presentation.pointsPerPage}.`, c.title,
          `Give it at most ${presentation.pointsPerPage}: move the extra items to a neighbouring page with room, or split the family into two pages. Keep the total count.`));
      }
    });
  }

  const rule = content.countBy;
  const claimed = book.title.match(/(?:^|\s)(\d{1,4})\+?\s/);
  if (rule !== 'none' && claimed) {
    const n = Number(claimed[1]);
    const items = book.chapters.filter((c) => isItemChapter(category, c, book.chapters));
    const got = rule === 'pages' ? items.length : items.reduce((s, c) => s + c.points.length, 0);
    if (got !== n) {
      out.push(finding('count', `The title promises ${n} but the book delivers ${got} ${rule}.`, book.title, `Deliver exactly ${n}, or retitle with the real count.`));
    }
  }
  return out;
}

/**
 * For categories whose items run on across pages ("Q12."), the numbers must climb by one through
 * the part, and on from the part before it when there is one: a split chapter must not restart
 * its range in the follow-up part. Items are read from headings and from qa blocks.
 */
export function numberingGates(slides: SlideLike[], category: string | undefined, prior: SlideLike[] = []): Finding[] {
  if (categoryOf(category).presentation.numbering !== 'continuous') return [];
  const numbers = (list: SlideLike[]) => list.flatMap((s, si) => s.blocks.flatMap((b) => {
    const text = b.type === 'heading' ? b.text : b.type === 'qa' ? b.q : undefined;
    const m = text?.match(/^Q(\d+)[.:]/i);
    return m ? [{ n: Number(m[1]), text: text!, page: si + 1 }] : [];
  }));
  let prev: number | null = numbers(prior).at(-1)?.n ?? null;
  const out: Finding[] = [];
  for (const { n, text, page } of numbers(slides)) {
    if (prev !== null && n !== prev + 1) {
      out.push(finding('numbering', `Q${n} follows Q${prev}: numbering skips or repeats.`, text, 'Renumber so every question follows the one before.', page));
    }
    prev = n;
  }
  return out;
}

/**
 * The finished pages, across every part of the chapter: a title used twice reads as a repeated
 * page. The book can be clean and the pages still repeat, since polish and spills rename pages.
 */
export function pageTitleGates(titlesByPart: string[][]): Finding[] {
  const seen = new Map<string, string>();
  const out: Finding[] = [];
  titlesByPart.forEach((titles, pi) => titles.forEach((t, si) => {
    // A "(cont.)" page says outright that it carries on the page before; the heading pass names it.
    if (/ \(cont\.\)$/.test(t)) return;
    const k = norm(t);
    const at = `part ${pi + 1} page ${si + 1}`;
    if (seen.has(k)) out.push(finding('duplicate-page', `The title on ${at} repeats ${seen.get(k)}.`, t, 'Give the page a title for what it alone covers.'));
    else seen.set(k, at);
  }));
  return out;
}
