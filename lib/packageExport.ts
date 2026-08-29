import { promises as fs } from 'fs';
import path from 'path';
import { loadPost, postDir } from './store';

export async function packagePost(slug: string): Promise<{ dir: string; files: string[] }> {
  const post = await loadPost(slug);
  const rendersDir = path.join(postDir(slug), 'renders');
  const polishedDir = path.join(rendersDir, 'polished');

  let files: string[] = [];
  try {
    files = (await fs.readdir(rendersDir)).filter((f) => /^slide-\d+\.png$/.test(f)).sort();
  } catch {
    throw new Error('render first');
  }
  if (!files.length) throw new Error('render first');
  if (files.length !== post.slides.length) {
    throw new Error(`rendered ${files.length} of ${post.slides.length} slides — render all first`);
  }

  // Refuse packaging when the last render reported overflow.
  try {
    const report = JSON.parse(await fs.readFile(path.join(rendersDir, 'render-report.json'), 'utf8'));
    const bad = Object.entries(report as Record<string, { overflowPx: number }>)
      .filter(([, v]) => v.overflowPx > 0)
      .map(([k]) => k);
    if (bad.length) throw new Error(`slides ${bad.join(', ')} overflow — fix before packaging`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('overflow')) throw err;
    // Missing report: renders exist but no report — allow (legacy), overflow guard ran at render time.
  }

  const usePolished = await fs.readdir(polishedDir).then((p) => p.length >= files.length).catch(() => false);
  const srcDir = usePolished ? polishedDir : rendersDir;

  const exportDir = path.join(postDir(slug), 'export');
  await fs.rm(exportDir, { recursive: true, force: true });
  await fs.mkdir(exportDir, { recursive: true });

  const out: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const dest = `${String(i + 1).padStart(2, '0')}.png`;
    await fs.copyFile(path.join(srcDir, files[i]), path.join(exportDir, dest));
    out.push(dest);
  }

  const caption = `${post.caption.text}\n\n${post.caption.hashtags.join(' ')}\n`;
  await fs.writeFile(path.join(exportDir, 'caption.txt'), caption);
  out.push('caption.txt');

  return { dir: exportDir, files: out };
}
