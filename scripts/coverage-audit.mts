// Reports, per chapter, which book points its rendered pages no longer teach.
import { loadBook } from '../lib/ai/book';
import { chapterGaps } from '../lib/ai/repair';

for (const key of process.argv.slice(2)) {
  const [subject, chapter] = key.split('/');
  const book = await loadBook(subject, chapter);
  if (!book) {
    console.log(`${key}: no book`);
    continue;
  }
  const missing = await chapterGaps(subject, chapter);
  const total = book.chapters.reduce((n, c) => n + c.points.length, 0);
  console.log(`${key}: ${total - missing.length}/${total} points covered, ${missing.length} missing`);
  for (const m of missing.slice(0, 6)) console.log('   - ' + m.slice(0, 90));
}
