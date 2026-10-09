import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Writes through a temp file of its own, so two writers never share one, then renames it into place.
 * On Windows the rename fails while a reader has the target open, so it is tried a few more times.
 */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, file);
        return;
      } catch (err) {
        if (attempt >= 6 || !BUSY.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
      }
    }
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
