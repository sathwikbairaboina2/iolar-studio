// Rebuilds the SQLite index + knowledge graph from the files on disk.
import { promises as fs } from 'fs';
import { listSubjects, listChapters, listParts, loadPost, loadSubject, partStatus } from '../lib/store';
import { syncSubject, syncChapter, syncBook, syncReferences } from '../lib/graph';
import { BookSchema } from '../lib/ai/book';
import { bookFile, referencesFile } from '../lib/paths';

for (const meta of await listSubjects()) {
  syncSubject(await loadSubject(meta.slug));

  for (const chapter of await listChapters(meta.slug)) {
    for (const part of await listParts(meta.slug, chapter.slug)) {
      try {
        const post = await loadPost(meta.slug, chapter.slug, part);
        syncChapter(meta.slug, chapter.slug, post, await partStatus(meta.slug, chapter.slug, part));
      } catch { /* part without a readable post */ }
    }
    try {
      const book = BookSchema.parse(JSON.parse(await fs.readFile(bookFile(meta.slug, chapter.slug), 'utf8')));
      syncBook(meta.slug, chapter.slug, book);
    } catch { /* no book */ }
    try {
      const refs = JSON.parse(await fs.readFile(referencesFile(meta.slug, chapter.slug), 'utf8'));
      syncReferences(meta.slug, chapter.slug, refs.urls ?? []);
    } catch { /* no references */ }
    console.log('indexed', meta.slug + '/' + chapter.slug);
  }
}
console.log('done');
