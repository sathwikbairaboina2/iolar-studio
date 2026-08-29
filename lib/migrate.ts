import { promises as fs } from 'fs';
import path from 'path';
import {
  bookFile, chapterDir, chapterFile, dataRoot, partDir, referencesFile, refsDir,
  subjectDir, subjectFile,
} from './paths';

/** Subjects recognised in a legacy slug's leading token; anything else lands in `misc`. */
const SUBJECTS: Record<string, string> = {
  python: '🐍', sql: '🗄️', dsa: '🧠', 'system-design': '⚙️', misc: '📓',
};

function titleCase(slug: string) {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function exists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Rename across devices safely: try rename, fall back to a recursive copy. */
async function move(from: string, to: string) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch {
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

/** `python-data-structures-part-2` -> subject python, chapter data-structures, part 2 */
function classify(slug: string): { subject: string; chapter: string; part: number } {
  const m = slug.match(/^(.*)-part-(\d+)$/);
  const stem = m ? m[1] : slug;
  const part = m ? Number(m[2]) : 1;

  for (const subject of Object.keys(SUBJECTS)) {
    if (subject === 'misc') continue;
    if (stem === subject) return { subject, chapter: subject, part };
    if (stem.startsWith(`${subject}-`)) {
      return { subject, chapter: stem.slice(subject.length + 1), part };
    }
  }
  return { subject: 'misc', chapter: stem, part };
}

export async function migratePaperbook(): Promise<{ moved: { from: string; to: string }[]; skipped: string[] }> {
  const legacyRoot = path.join(dataRoot(), 'paperbook');
  const moved: { from: string; to: string }[] = [];
  const skipped: string[] = [];
  if (!(await exists(legacyRoot))) return { moved, skipped };

  const slugs = (await fs.readdir(legacyRoot)).sort();
  for (const slug of slugs) {
    const from = path.join(legacyRoot, slug);
    if (!(await fs.stat(from)).isDirectory()) continue;

    const { subject, chapter, part } = classify(slug);
    const to = partDir(subject, chapter, part);
    if (await exists(to)) { skipped.push(slug); continue; }

    await move(from, to);
    moved.push({ from, to });

    if (!(await exists(subjectFile(subject)))) {
      await fs.mkdir(subjectDir(subject), { recursive: true });
      await fs.writeFile(subjectFile(subject), JSON.stringify({
        slug: subject, name: titleCase(subject), emoji: SUBJECTS[subject] ?? '📓', description: '',
      }, null, 2));
    }
    if (!(await exists(chapterFile(subject, chapter)))) {
      await fs.mkdir(chapterDir(subject, chapter), { recursive: true });
      await fs.writeFile(chapterFile(subject, chapter), JSON.stringify({
        title: titleCase(chapter), created: new Date().toISOString(),
      }, null, 2));
    }

    // The book, reference list and reference images belong to the chapter, not a part.
    for (const [partPath, chapterPath] of [
      [path.join(to, 'book.json'), bookFile(subject, chapter)],
      [path.join(to, 'references.json'), referencesFile(subject, chapter)],
      [path.join(to, 'refs'), refsDir(subject, chapter)],
    ] as const) {
      if (!(await exists(partPath))) continue;
      if (await exists(chapterPath)) {
        await fs.rm(partPath, { recursive: true, force: true });
      } else {
        await move(partPath, chapterPath);
      }
    }
  }

  // Drop the legacy root once it holds nothing but empty directories.
  try {
    if ((await fs.readdir(legacyRoot)).length === 0) await fs.rmdir(legacyRoot);
  } catch { /* leave anything unexpected in place */ }

  return { moved, skipped };
}
