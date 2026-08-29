import { promises as fs } from 'fs';
import path from 'path';
import { loadPost } from './store';
import { rendersDir, exportDir } from './paths';
import { loadReview, reviewIsCurrent } from './verify/review';

export async function packagePost(
  subject: string, chapter: string, part: number
): Promise<{ dir: string; files: string[] }> {
  const post = await loadPost(subject, chapter, part);
  const rDir = rendersDir(subject, chapter, part);
  const polishedDir = path.join(rDir, 'polished');

  let files: string[] = [];
  try {
    files = (await fs.readdir(rDir)).filter((f) => /^slide-\d+\.png$/.test(f)).sort();
  } catch {
    throw new Error('render first');
  }
  if (!files.length) throw new Error('render first');
  if (files.length !== post.slides.length) {
    throw new Error(`rendered ${files.length} of ${post.slides.length} slides — render all first`);
  }

  // Refuse packaging when the last render reported overflow.
  try {
    const report = JSON.parse(await fs.readFile(path.join(rDir, 'render-report.json'), 'utf8'));
    const bad = Object.entries(report as Record<string, { overflowPx: number }>)
      .filter(([, v]) => v.overflowPx > 0)
      .map(([k]) => k);
    if (bad.length) throw new Error(`slides ${bad.join(', ')} overflow — fix before packaging`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('overflow')) throw err;
    // Missing report: renders exist but no report — allow (legacy), overflow guard ran at render time.
  }

  // A blocker-severity review finding stops publication until it is cleared.
  if (await reviewIsCurrent(subject, chapter, part)) {
    const review = await loadReview(subject, chapter, part);
    const blockers = review?.findings.filter((f) => f.severity === 'blocker') ?? [];
    if (blockers.length) {
      throw new Error(
        `review has ${blockers.length} blocker(s) — first: ${blockers[0].summary} (page ${blockers[0].page})`
      );
    }
  }

  const usePolished = await fs.readdir(polishedDir).then((p) => p.length >= files.length).catch(() => false);
  const srcDir = usePolished ? polishedDir : rDir;

  const outDir = exportDir(subject, chapter, part);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const out: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const dest = `${String(i + 1).padStart(2, '0')}.png`;
    await fs.copyFile(path.join(srcDir, files[i]), path.join(outDir, dest));
    out.push(dest);
  }

  const caption = `${post.caption.text}\n\n${post.caption.hashtags.join(' ')}\n`;
  await fs.writeFile(path.join(outDir, 'caption.txt'), caption);
  out.push('caption.txt');

  return { dir: outDir, files: out };
}
