import { MAX_SLIDES, Post, validatePost } from '../schema';
import { createPart, loadPost, nextPartNumber, savePost } from '../store';
import { mergeContinuations } from '../renderer/capture';

/** "AWS VPC (cont.)" and "AWS VPC" are the same chapter. */
const baseTitle = (s: Post['slides'][number]) => s.page_title.replace(/ \(cont\.\)$/, '');

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

  await createPart(subject, chapter, next, validatePost({
    ...post,
    series: `${post.series.replace(/ — PART \d+$/i, '')} — PART ${next}`,
    slides,
    caption: {
      text: `Part ${next} of ${post.series.replace(/ — PART \d+$/i, '')}. ${post.caption.text}`.trim(),
      hashtags: post.caption.hashtags,
    },
    spilledFrom: part,
  } satisfies Post));

  await savePost(subject, chapter, part, { ...post, slides: kept });
  return { moved: moved.length, part: next };
}
