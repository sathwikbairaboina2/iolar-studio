import { listSubjects, listChapters, listParts, loadPost } from '../lib/store';
import { loadBook } from '../lib/ai/book';
import { uncoveredPoints } from '../lib/ai/fit';
import type { Post } from '../lib/schema';

for (const s of await listSubjects()) {
  for (const c of await listChapters(s.slug)) {
    const book = await loadBook(s.slug, c.slug);
    if (!book) continue;
    const parts = await listParts(s.slug, c.slug);
    let merged: Post | null = null;
    for (const p of parts) {
      const post = await loadPost(s.slug, c.slug, p);
      merged = merged === null ? post : { ...merged, slides: [...merged.slides, ...post.slides] };
    }
    if (!merged) continue;
    const total = book.chapters.reduce((n, x) => n + x.points.length, 0);
    const missing = uncoveredPoints(book, merged);
    const pct = Math.round((1 - missing.length / total) * 100);
    console.log(`${s.slug}/${c.slug}: ${total} points, ${missing.length} uncovered (${pct}% covered)`);
    for (const m of missing.slice(0, 2)) console.log('    missing:', m.slice(0, 90));
  }
}
