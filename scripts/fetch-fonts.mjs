// Vendors Google handwriting fonts locally so renders are deterministic and offline.
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const FAMILIES = [
  'Caveat:wght@500;700',
  'Kalam:wght@300;400;700',
  'Patrick+Hand',
  'Shadows+Into+Light',
  'Architects+Daughter',
  'Gochi+Hand',
  'JetBrains+Mono:wght@400;700',
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const outDir = path.resolve('templates/_shared/fonts');
mkdirSync(outDir, { recursive: true });

const url = `https://fonts.googleapis.com/css2?${FAMILIES.map((f) => `family=${f}`).join('&')}&display=block`;
const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();

let localCss = '';
const seen = new Set();
// Parse each @font-face block, download its woff2, rewrite src to local path.
const blocks = css.match(/@font-face\s*{[^}]+}/g) ?? [];
for (const block of blocks) {
  const family = block.match(/font-family:\s*'([^']+)'/)?.[1];
  const weight = block.match(/font-weight:\s*(\d+)/)?.[1] ?? '400';
  const style = block.match(/font-style:\s*(\w+)/)?.[1] ?? 'normal';
  const src = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
  const unicode = block.match(/unicode-range:\s*([^;]+);/)?.[1];
  // keep only latin subset blocks (they contain U+0000-00FF)
  if (!src || !family || !unicode?.includes('U+0000-00FF')) continue;
  const key = `${family}-${weight}-${style}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const fname = `${key.replace(/\s+/g, '')}.woff2`;
  const buf = Buffer.from(await (await fetch(src, { headers: { 'User-Agent': UA } })).arrayBuffer());
  writeFileSync(path.join(outDir, fname), buf);
  localCss += `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};src:url('fonts/${fname}') format('woff2');font-display:block}\n`;
  console.log('vendored', fname, buf.length, 'bytes');
}

writeFileSync(path.resolve('templates/_shared/fonts.css'), localCss);
console.log('wrote fonts.css with', seen.size, 'faces');
