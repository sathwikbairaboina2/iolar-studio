import { loadBook } from '../lib/ai/book';
import { uncoveredPoints } from '../lib/ai/fit';
import { listParts, loadPost } from '../lib/store';

const chapters = process.argv.slice(2);
for (const key of chapters) {
  const [subject, chapter] = key.split('/');
  const book = await loadBook(subject, chapter);
  const parts = await listParts(subject, chapter);
  const posts = await Promise.all(parts.map((p) => loadPost(subject, chapter, p)));
  const merged = { ...posts[0], slides: posts.flatMap((p) => p.slides) };
  const missing = uncoveredPoints(book, merged as any);
  const total = book.chapters.reduce((n, c) => n + (c.points?.length ?? 0), 0);
  console.log(`${key}: ${total - missing.length}/${total} points covered, ${missing.length} missing`);
  for (const m of missing.slice(0, 6)) console.log('   - ' + m.slice(0, 90));
}
