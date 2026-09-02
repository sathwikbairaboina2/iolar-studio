// Rebuilds the SQLite index + knowledge graph from the files on disk.
import { promises as fs } from 'fs';
import { listSubjects, listChapters, listParts, loadPost, loadSubject, partStatus } from '../lib/store';
import { syncSubject, syncChapter, syncBook } from '../lib/knowledge/spaces/handbooks';
import { syncReferences, indexSubject, indexChapter, indexBook } from '../lib/handbookIndex';
import { BookSchema } from '../lib/ai/book';
import { bookFile, referencesFile } from '../lib/paths';

for (const meta of await listSubjects()) {
  const subject = await loadSubject(meta.slug);
  indexSubject(subject);
  await syncSubject(subject);

  for (const chapter of await listChapters(meta.slug)) {
    for (const part of await listParts(meta.slug, chapter.slug)) {
      try {
        const post = await loadPost(meta.slug, chapter.slug, part);
        const status = await partStatus(meta.slug, chapter.slug, part);
        indexChapter(meta.slug, chapter.slug, post, status);
        await syncChapter(meta.slug, chapter.slug, post, status);
      } catch { /* part without a readable post */ }
    }
    try {
      const book = BookSchema.parse(JSON.parse(await fs.readFile(bookFile(meta.slug, chapter.slug), 'utf8')));
      indexBook(meta.slug, chapter.slug, book);
      await syncBook(meta.slug, chapter.slug, book);
    } catch { /* no book */ }
    try {
      const refs = JSON.parse(await fs.readFile(referencesFile(meta.slug, chapter.slug), 'utf8'));
      syncReferences(meta.slug, chapter.slug, refs.urls ?? []);
    } catch { /* no references */ }
    console.log('indexed', meta.slug + '/' + chapter.slug);
  }
}
console.log('done');
