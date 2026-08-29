import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { renderSlide, closeBrowser } from '@/lib/renderer/capture';
import { validatePost } from '@/lib/schema';

const fixture = JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/golden-post.json'), 'utf8'));
const goldenDir = path.join(process.cwd(), 'tests', 'golden');
const templates = readdirSync(path.join(process.cwd(), 'templates')).filter(
  (d) => !d.startsWith('_') && existsSync(path.join(process.cwd(), 'templates', d, 'template.html'))
);

afterAll(async () => { await closeBrowser(); });

describe.skipIf(!existsSync(goldenDir))('golden renders', () => {
  it.each(templates)(
    '%s matches approved goldens',
    async (template) => {
      const post = validatePost({ ...fixture, template });
      for (let i = 0; i < post.slides.length; i++) {
        const golden = path.join(goldenDir, `${template}-${i + 1}.png`);
        if (!existsSync(golden)) continue;
        const out = path.join(tmpdir(), `iolar-golden-${template}-${i + 1}-${Date.now()}.png`);
        await renderSlide(post, i, out);
        const same = Buffer.compare(readFileSync(out), readFileSync(golden)) === 0;
        expect(
          same,
          `${template} slide ${i + 1} differs from golden. If the change is intentional, re-run: node scripts/approve-goldens.mjs`
        ).toBe(true);
      }
    },
    300_000
  );
});
