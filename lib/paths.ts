import path from 'path';

/** Every path under the handbooks tree lives here so the layout is stated once. */

export function dataRoot() {
  return process.env.IOLAR_DATA_DIR ?? path.join(process.cwd(), 'data');
}

export function handbooksRoot() {
  return path.join(dataRoot(), 'handbooks');
}

export function isSlug(v: string) {
  return /^[a-z0-9-]+$/.test(v);
}

export function slugify(v: string) {
  return v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function partName(n: number) {
  return String(n).padStart(2, '0');
}

export function subjectDir(s: string) { return path.join(handbooksRoot(), s); }
export function subjectFile(s: string) { return path.join(subjectDir(s), 'subject.json'); }
export function chapterDir(s: string, c: string) { return path.join(subjectDir(s), c); }
export function chapterFile(s: string, c: string) { return path.join(chapterDir(s, c), 'chapter.json'); }
export function bookFile(s: string, c: string) { return path.join(chapterDir(s, c), 'book.json'); }
export function referencesFile(s: string, c: string) { return path.join(chapterDir(s, c), 'references.json'); }
export function refsDir(s: string, c: string) { return path.join(chapterDir(s, c), 'refs'); }
export function partsDir(s: string, c: string) { return path.join(chapterDir(s, c), 'parts'); }
export function partDir(s: string, c: string, part: number) { return path.join(partsDir(s, c), partName(part)); }
export function postFile(s: string, c: string, part: number) { return path.join(partDir(s, c, part), 'post.json'); }
export function rendersDir(s: string, c: string, part: number) { return path.join(partDir(s, c, part), 'renders'); }
export function exportDir(s: string, c: string, part: number) { return path.join(partDir(s, c, part), 'export'); }
