import { promises as fs } from 'fs';
import path from 'path';
import { MAX_SLIDES, Post, validatePost } from '../schema';
import { loadPost, savePost, postDir, createPost } from '../store';
import { Book, loadBook, saveBook } from './book';
import { uncoveredPoints } from './fit';

/**
 * Content is never trimmed to fit a carousel. When a post renders past the 10-image limit,
 * the surplus pages move into a follow-up post with their own book slice, and the two are
 * linked so the knowledge graph shows them as one series.
 */
export async function splitIntoFollowUp(
  slug: string,
  limit = MAX_SLIDES
): Promise<{ moved: number; childSlug: string } | null> {
  const post = await loadPost(slug);
  if (post.slides.length <= limit) return null;

  const kept = post.slides.slice(0, limit);
  const moved = post.slides.slice(limit);

  // Child slug: foo -> foo-part-2, foo-part-2 -> foo-part-3, ...
  const m = slug.match(/^(.*)-part-(\d+)$/);
  const stem = m ? m[1] : slug;
  const nextPart = m ? Number(m[2]) + 1 : 2;
  const childSlug = `${stem}-part-${nextPart}`;

  const childPost: Post = validatePost({
    ...post,
    series: `${post.series.replace(/ — PART \d+$/i, '')} — PART ${nextPart}`,
    slides: moved.map((s, i) => ({ ...s, cont: i === 0 ? undefined : s.cont })),
    caption: {
      text: `Part ${nextPart} of ${post.series}. ${post.caption.text}`.trim(),
      hashtags: post.caption.hashtags,
    },
  });

  await createPost(childSlug, childPost).catch(async () => {
    await savePost(childSlug, childPost);
  });
  await savePost(childSlug, childPost);

  // Give the child the slice of the book its pages actually teach.
  const book = await loadBook(slug);
  if (book) {
    const stillInParent = new Set(uncoveredPoints(book, { ...post, slides: kept }));
    const childChapters = book.chapters
      .map((ch) => ({ title: ch.title, points: ch.points.filter((p) => stillInParent.has(p)) }))
      .filter((ch) => ch.points.length);
    if (childChapters.length) {
      const childBook: Book = {
        title: `${book.title} — Part ${nextPart}`,
        summary: `Continuation of ${book.title}.`,
        chapters: childChapters,
      };
      await saveBook(childSlug, childBook);
    }
  }

  // Copy the reference list across so the child keeps its provenance.
  try {
    const refs = await fs.readFile(path.join(postDir(slug), 'references.json'), 'utf8');
    await fs.writeFile(path.join(postDir(childSlug), 'references.json'), refs);
  } catch {
    /* no references saved */
  }

  await savePost(slug, { ...post, slides: kept });
  return { moved: moved.length, childSlug };
}
