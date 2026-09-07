import { MAX_SLIDES, Post, validatePost } from '../schema';
import { createPart, listParts, loadPost, savePost } from '../store';

const seriesBase = (series: string) => series.replace(/ — PART \d+$/i, '');

/** A part always opens on its own page, never as a continuation of the part before it. */
const openPart = (slides: Post['slides']) =>
  slides.map((s, i) => (i === 0 ? { ...s, cont: undefined } : s));

/**
 * Content is never trimmed to fit a carousel. When a part renders past the 10-image limit,
 * the surplus pages move into the NEXT PART of the same chapter — the book and reference
 * list already belong to the chapter, so the follow-up inherits them for free.
 *
 * A part that already exists is EXTENDED, never replaced: the surplus goes in front of the
 * content that part already holds, and whatever no longer fits cascades down the chain,
 * creating a new final part only when the last one overflows. Overwriting the next part
 * instead — which is what this used to do — silently destroyed everything it held.
 */
export async function splitIntoFollowUp(
  subject: string,
  chapter: string,
  part: number,
  limit = MAX_SLIDES
): Promise<{ moved: number; part: number } | null> {
  const post = await loadPost(subject, chapter, part);
  if (post.slides.length <= limit) return null;

  const overflow = post.slides.slice(limit);
  await savePost(subject, chapter, part, { ...post, slides: post.slides.slice(0, limit) });

  const existing = new Set(await listParts(subject, chapter));
  const base = seriesBase(post.series);
  let carry = overflow;
  let target = part + 1;

  while (carry.length) {
    if (existing.has(target)) {
      const next = await loadPost(subject, chapter, target);
      const combined = [...carry, ...next.slides];
      await savePost(subject, chapter, target, {
        ...next,
        series: `${base} — PART ${target}`,
        slides: openPart(combined.slice(0, limit)),
      });
      carry = combined.slice(limit);
    } else {
      await createPart(subject, chapter, target, validatePost({
        ...post,
        series: `${base} — PART ${target}`,
        slides: openPart(carry.slice(0, limit)),
        caption: {
          text: `Part ${target} of ${base}. ${post.caption.text}`.trim(),
          hashtags: post.caption.hashtags,
        },
      } satisfies Post));
      carry = carry.slice(limit);
    }
    target += 1;
  }

  await balanceParts(subject, chapter, part, base);
  return { moved: overflow.length, part: part + 1 };
}

/** A part shorter than this reads as an offcut rather than a post. */
const MIN_PART = 4;
/** Never shrink the part we borrow from below this. */
const KEEP = 6;

/**
 * Splitting leaves the remainder on the last part, so a chapter one page over the limit used
 * to publish as ten pages plus a single orphan. Pages move back down the chain until the tail
 * is worth posting — nothing is added, removed or rewritten, only moved.
 */
async function balanceParts(subject: string, chapter: string, from: number, base: string) {
  const parts = (await listParts(subject, chapter)).filter((p) => p >= from).sort((a, b) => a - b);
  for (let i = parts.length - 1; i > 0; i--) {
    const tail = await loadPost(subject, chapter, parts[i]);
    const prev = await loadPost(subject, chapter, parts[i - 1]);
    let moved = 0;
    while (
      tail.slides.length + moved < MIN_PART &&
      prev.slides.length - moved > KEEP
    ) moved++;
    if (!moved) continue;

    const keep = prev.slides.slice(0, prev.slides.length - moved);
    const give = prev.slides.slice(prev.slides.length - moved);
    await savePost(subject, chapter, parts[i - 1], { ...prev, slides: keep });
    await savePost(subject, chapter, parts[i], {
      ...tail,
      series: `${base} — PART ${parts[i]}`,
      slides: openPart([...give, ...tail.slides]),
    });
  }
}
