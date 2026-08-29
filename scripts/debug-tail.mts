import path from 'path';
import { tmpdir } from 'os';
import { loadPost } from '../lib/store';
import { renderAll, closeBrowser } from '../lib/renderer/capture';

const [subject, chapter, part] = (process.argv[2] ?? 'linux/processes-signals/2').split('/');
const post = await loadPost(subject, chapter, Number(part));
console.log('authored pages:', post.slides.length, 'blocks:', post.slides.reduce((n, s) => n + s.blocks.length, 0));

const out = await renderAll(post, path.join(tmpdir(), 'instastudio-tail-probe'));
console.log('rendered pages:', out.results.length);
console.log('fills:', out.results.map((r) => r.fillPct).join(', '));
console.log('blocks per page:', out.slides.map((s) => s.blocks.length).join(', '));
await closeBrowser();
