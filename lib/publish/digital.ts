import { loadPost, listParts } from '@/lib/store';
import type { Post } from '@/lib/schema';
import { iconSvg } from '@/lib/renderer/icons';
import { SHAPE, askClaude } from '@/lib/verify/review';
import type { Finding } from '@/lib/verify/gates';

const SLIDE_WORDS = /\b(swipe|next slide|tap the|see slide)\b/i;
const PAGE_REF = /\b(?:p\.|page)\s?(\d+)\b/gi;

/** Fields whose strings are code, which would only add noise to prose checks. */
const CODE_KEYS = new Set(['lines', 'example_code', 'lang', 'type', 'kind', 'style', 'frame', 'ink', 'icon']);

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!CODE_KEYS.has(k)) strings(x, out);
  return out;
}

/** Every icon name a post uses: icon fields, hero, cover icons and {icon:name} in any text. */
export function iconNames(posts: Post[]): string[] {
  const names = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') for (const m of v.matchAll(/\{icon:([^{}\n]+?)\}/g)) names.add(m[1].trim());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if ((k === 'icon' || k === 'hero') && typeof x === 'string') names.add(x.trim());
        else walk(x);
      }
    }
  };
  for (const p of posts) walk(p.slides);
  names.delete('');
  return [...names];
}

const finding = (rule: string, severity: Finding['severity'], page: number, summary: string, evidence: string, fix: string): Finding =>
  ({ pass: 'digital', rule, severity, page, summary, evidence, fix });

/** Checks that need no AI: icons that resolve, carousel-only phrasing, and page references that exist. */
export function digitalGates(posts: Post[]): Finding[] {
  const out: Finding[] = [];
  for (const name of iconNames(posts)) {
    if (!iconSvg(name)) out.push(finding('digital.icon', 'major', 0, `The icon "${name}" has no artwork, so it would be missing on the site.`, name, 'Use an icon name the studio can resolve, or remove it.'));
  }
  const slides = posts.flatMap((p) => p.slides);
  slides.forEach((slide, i) => {
    const text = strings(slide.blocks).join('\n');
    const word = SLIDE_WORDS.exec(text);
    if (word) out.push(finding('digital.slide-words', 'minor', i + 1, 'The text talks about slides, which do not exist on the web page.', word[0], 'Reword it without slide gestures.'));
    for (const m of text.matchAll(PAGE_REF)) {
      if (Number(m[1]) > slides.length) out.push(finding('digital.page-ref', 'major', i + 1, `The text points to page ${m[1]}, past the end of the chapter.`, m[0], 'Point at a page that exists or remove the reference.'));
    }
  });
  return out;
}

/** Marks and icons become plain words so the model reads the prose, not the drawing syntax. */
function plain(s: string): string {
  return s
    .replace(/\{icon:[^{}\n]+?\}/g, '')
    .replace(/\{(?:green|blue|red|purple|orange|pink):([^{}]*)\}/g, '$1')
    .replace(/==|__|\*\*/g, '');
}

/** The gates plus one Claude pass that reads the whole chapter as a single web page. */
export async function digitalReview(subject: string, chapter: string): Promise<Finding[]> {
  const posts: Post[] = [];
  for (const n of await listParts(subject, chapter)) posts.push(await loadPost(subject, chapter, n));
  const gates = digitalGates(posts);
  const text = posts
    .map((p, i) => `## Part ${i + 1}\n${p.slides.map((s, j) => `### ${s.page_title} (page ${j + 1})\n${plain(strings(s.blocks).join('\n'))}`).join('\n\n')}`)
    .join('\n\n');
  const ai = await askClaude('digital', [
    'You are reviewing a technical handbook chapter that will be published as ONE continuous web page, not as carousel slides.',
    'Report only: the same point repeated across parts, a part that needs a link to an earlier or later part and has none, or phrasing that only makes sense on a carousel.',
    'Do not report wording style or density.',
    'Chapter text:', text, SHAPE,
  ].join('\n\n'));
  return [...gates, ...ai];
}
