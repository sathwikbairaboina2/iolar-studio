// Temp (untracked): one-slide render like the editor's preview, to read its page badge.
import { promises as fs } from 'fs';
import { renderSlide, closeBrowser } from '../lib/renderer/capture';
import { validatePost } from '../lib/schema';
const post = validatePost(JSON.parse(await fs.readFile('data/handbooks/category-test-r4/api-questions/parts/01/post.json', 'utf8')));
const r = await renderSlide(post, 1, 'data/.samples/one-slide-2.png');
console.log(post.slides.length, r.fillPct);
await closeBrowser();
