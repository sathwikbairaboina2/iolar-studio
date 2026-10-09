// Temp (untracked): render a handbook part with a different template into data/.samples/.
// usage: npx tsx scripts/.render-sample.mts <subject> <chapter> <part> [template] [--fixtures=name]
// Never writes post.json. Closes the browser at the end (memory is tight on this machine).
import { promises as fs } from 'fs';
import path from 'path';
import { renderAll, closeBrowser } from '../lib/renderer/capture';
import { validatePost } from '../lib/schema';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [subject, chapter, part = '1', template] = args;

let raw: unknown;
if (flags.fixtures) {
  raw = JSON.parse(await fs.readFile(path.join('scripts', '.fixtures', `${flags.fixtures}.json`), 'utf8'));
} else {
  const file = path.join('data', 'handbooks', subject, chapter, 'parts', String(part).padStart(2, '0'), 'post.json');
  raw = JSON.parse(await fs.readFile(file, 'utf8'));
}
const post = validatePost(raw);
if (template) post.template = template as typeof post.template;
const name = flags.fixtures ?? chapter;
const outDir = path.join('data', '.samples', `${name}-${post.template}`);
await fs.rm(outDir, { recursive: true, force: true });
const { results, slides } = await renderAll(post, outDir);
for (const r of results) console.log(`slide ${r.slide}: fill ${r.fillPct}% overflow ${r.overflowPx}${r.warnings.length ? ' warnings ' + r.warnings.join('; ') : ''}`);
console.log(`${slides.length} pages -> ${outDir}`);
await closeBrowser();
