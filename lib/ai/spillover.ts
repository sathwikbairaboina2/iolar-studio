import { MAX_SLIDES, Post, validatePost } from '../schema';
import { createPart, loadPost, nextPartNumber, savePost } from '../store';
import { mergeContinuations } from '../renderer/capture';

/** "AWS VPC (cont.)" and "AWS VPC" are the same chapter. */
const baseTitle = (s: Post['slides'][number]) => s.page_title.replace(/ \(cont\.\)$/, '');

/** The chapters a run of slides covers, once each, in order. */
const chaptersOf = (slides: Post['slides']) => [...new Set(slides.map(baseTitle))];

const listed = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * A follow-up part's caption: the handbook's hook, then what THIS part covers.
 *
 * The feed shows the first sentence, so it has to be the hook, never a "Part N of X" label.
 * And the rest of the parent caption describes the whole handbook ("Ten pages on…"), which is
 * wrong for a part holding two of its chapters — the part's own page titles say what it holds.
 * The hook survives any number of re-spills because it is always the first sentence, and the
 * old "Part N of X." prefix is stripped so captions written before this still yield it.
 */
export function followUpCaption(parentText: string, series: string, part: number, chapters: string[]): string {
  const body = parentText.replace(/^(Part \d+ of [^.]+\.\s*)+/i, '').trim();
  const hook = body.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? '';
  return `${hook} Part ${part} of ${series} covers ${listed(chapters)}.`.trim();
}

/**
 * Content is never trimmed to fit a carousel. When a part renders past the 10-image limit,
 * the surplus pages move into the NEXT PART of the same chapter — the book and reference
 * list already belong to the chapter, so the follow-up inherits them for free.
 */
export async function splitIntoFollowUp(
  subject: string,
  chapter: string,
  part: number,
  limit = MAX_SLIDES
): Promise<{ moved: number; part: number } | null> {
  const post = await loadPost(subject, chapter, part);
  if (post.slides.length <= limit) return null;

  const kept = post.slides.slice(0, limit);
  const moved = post.slides.slice(limit);

  // The surplus always lands in this part's own follow-up. A re-render must not mint a new
  // part each time: reuse the follow-up when it was created by an earlier spill from here.
  const following = await loadPost(subject, chapter, part + 1).catch(() => null);
  const reuse = following?.spilledFrom === part;
  const next = reuse ? part + 1 : await nextPartNumber(subject, chapter);

  // A re-spill merges: the new surplus first, then whatever chapters the follow-up already
  // held that neither this part nor the surplus covers any more. Overwriting would drop the
  // chapters an earlier, larger spill moved here — content that now lives nowhere else.
  const covered = new Set([...kept, ...moved].map(baseTitle));
  const carried = reuse && following ? mergeContinuations(following.slides).filter((s) => !covered.has(baseTitle(s))) : [];
  const slides = [...moved.map((s, i) => (i === 0 ? { ...s, cont: undefined } : s)), ...carried];

  const series = post.series.replace(/ — PART \d+$/i, '');
  await createPart(subject, chapter, next, validatePost({
    ...post,
    series: `${series} — PART ${next}`,
    slides,
    caption: { text: followUpCaption(post.caption.text, series, next, chaptersOf(slides)), hashtags: post.caption.hashtags },
    spilledFrom: part,
  } satisfies Post));

  // A follow-up that spills again no longer holds what its caption lists. Part 1's caption
  // is authored for the whole handbook and is left alone.
  const caption = post.spilledFrom !== undefined
    ? { ...post.caption, text: followUpCaption(post.caption.text, series, part, chaptersOf(kept)) }
    : post.caption;
  await savePost(subject, chapter, part, { ...post, slides: kept, caption });
  return { moved: moved.length, part: next };
}
