import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function seed(root: string) {
  const a = path.join(root, 'paperbook', 'python-data-structures');
  const b = path.join(root, 'paperbook', 'python-data-structures-part-2');
  mkdirSync(path.join(a, 'renders'), { recursive: true });
  mkdirSync(path.join(a, 'refs'), { recursive: true });
  mkdirSync(b, { recursive: true });
  writeFileSync(path.join(a, 'post.json'), '{"slides":"A"}');
  writeFileSync(path.join(a, 'book.json'), '{"title":"Book"}');
  writeFileSync(path.join(a, 'references.json'), '{"urls":["http://x/1"]}');
  writeFileSync(path.join(a, 'refs', 'ref-01.jpg'), 'JPEGBYTES');
  writeFileSync(path.join(a, 'renders', 'slide-01.png'), 'PNG');
  writeFileSync(path.join(b, 'post.json'), '{"slides":"B"}');
}

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-mig-'));
});

describe('migratePaperbook', () => {
  it('moves a post and its part 2 into one chapter', async () => {
    const root = process.env.IOLAR_DATA_DIR!;
    seed(root);
    const { migratePaperbook } = await import('@/lib/migrate');
    const res = await migratePaperbook();
    expect(res.moved.length).toBeGreaterThan(0);

    const ch = path.join(root, 'handbooks', 'python', 'data-structures');
    expect(readFileSync(path.join(ch, 'parts', '01', 'post.json'), 'utf8')).toBe('{"slides":"A"}');
    expect(readFileSync(path.join(ch, 'parts', '02', 'post.json'), 'utf8')).toBe('{"slides":"B"}');
    expect(existsSync(path.join(ch, 'parts', '01', 'renders', 'slide-01.png'))).toBe(true);

    expect(readFileSync(path.join(ch, 'book.json'), 'utf8')).toBe('{"title":"Book"}');
    expect(readFileSync(path.join(ch, 'references.json'), 'utf8')).toContain('http://x/1');
    expect(readFileSync(path.join(ch, 'refs', 'ref-01.jpg'), 'utf8')).toBe('JPEGBYTES');
    expect(existsSync(path.join(ch, 'parts', '01', 'book.json'))).toBe(false);

    expect(JSON.parse(readFileSync(path.join(root, 'handbooks', 'python', 'subject.json'), 'utf8')).name).toBe('Python');
  });

  it('is idempotent', async () => {
    seed(process.env.IOLAR_DATA_DIR!);
    const { migratePaperbook } = await import('@/lib/migrate');
    await migratePaperbook();
    const second = await migratePaperbook();
    expect(second.moved).toEqual([]);
  });

  it('files an unrecognised slug under misc', async () => {
    const root = process.env.IOLAR_DATA_DIR!;
    mkdirSync(path.join(root, 'paperbook', 'random-notes'), { recursive: true });
    writeFileSync(path.join(root, 'paperbook', 'random-notes', 'post.json'), '{}');
    const { migratePaperbook } = await import('@/lib/migrate');
    await migratePaperbook();
    expect(existsSync(path.join(root, 'handbooks', 'misc', 'random-notes', 'parts', '01', 'post.json'))).toBe(true);
  });
});
