import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { bookFile, postFile } from '@/lib/paths';
import { listParts } from '@/lib/store';

/** Changes whenever the outline or any part's content changes; a review is reused only while it is unchanged. */
export async function chapterHash(subject: string, chapter: string): Promise<string> {
  const h = createHash('sha256');
  h.update(await readFile(bookFile(subject, chapter), 'utf8').catch(() => ''));
  for (const n of await listParts(subject, chapter)) h.update(`\u0000${n}\u0000`).update(await readFile(postFile(subject, chapter, n), 'utf8'));
  return h.digest('hex');
}
