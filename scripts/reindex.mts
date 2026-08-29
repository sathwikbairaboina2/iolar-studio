// Rebuilds the SQLite index + knowledge graph from the files on disk.
import { promises as fs } from 'fs';
import path from 'path';
import { listPosts, loadPost, postDir, postStatus } from '../lib/store';
import { syncPost, syncBook, syncReferences } from '../lib/graph';
import { BookSchema } from '../lib/ai/book';

for (const meta of await listPosts()) {
  const post = await loadPost(meta.slug);
  syncPost(meta.slug, post, await postStatus(meta.slug));
  try {
    const book = BookSchema.parse(JSON.parse(await fs.readFile(path.join(postDir(meta.slug), 'book.json'), 'utf8')));
    syncBook(meta.slug, book);
  } catch { /* no book */ }
  try {
    const refs = JSON.parse(await fs.readFile(path.join(postDir(meta.slug), 'references.json'), 'utf8'));
    syncReferences(meta.slug, refs.urls ?? []);
  } catch { /* no refs */ }
  console.log('indexed', meta.slug);
}
console.log('done');
