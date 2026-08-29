// Renders the golden fixture with every built template into tests/golden/.
// Run after INTENTIONAL visual changes, inspect the PNGs, and commit them.
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { register } from 'tsx/esm/api';
register();

const { renderSlide, closeBrowser } = await import('../lib/renderer/capture.ts');
const { validatePost } = await import('../lib/schema.ts');

const fixture = JSON.parse(readFileSync('tests/fixtures/golden-post.json', 'utf8'));
const templates = readdirSync('templates').filter(
  (d) => !d.startsWith('_') && existsSync(path.join('templates', d, 'template.html'))
);

mkdirSync('tests/golden', { recursive: true });

for (const template of templates) {
  const post = validatePost({ ...fixture, template });
  for (let i = 0; i < post.slides.length; i++) {
    const out = path.join('tests', 'golden', `${template}-${i + 1}.png`);
    const r = await renderSlide(post, i, out);
    console.log(`${template} slide ${i + 1}: overflow ${r.overflowPx}px -> ${out}`);
  }
}
await closeBrowser();
console.log('Done. Inspect tests/golden/*.png and commit.');
