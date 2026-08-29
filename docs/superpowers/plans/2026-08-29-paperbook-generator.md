# iolar studio — Paperbook Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the iolar studio Next.js app that turns structured JSON into Instagram-ready handwritten-notes carousel PNGs (category "paperbook"), with AI revise/pagination chat and ComfyUI polish.

**Architecture:** Deterministic render pipeline (post.json → HTML templates + handwriting fonts + rough.js → Playwright screenshot → PNG) wrapped in a Next.js App Router app with antd (Midnight Studio dark theme + light variant). Claude CLI headless powers content planning/revision behind a diff-approve gate. ComfyUI Desktop instance (127.0.0.1:8188) handles optional realism/doodle jobs.

**Tech Stack:** Next.js 15 (App Router, TS), Ant Design 5, zod, Playwright, rough.js, sharp, vitest + @testing-library/react, Claude Code CLI, ComfyUI HTTP API.

**Spec:** `docs/superpowers/specs/2026-08-29-iolar-type1-notes-carousels-design.md`

## Global Constraints

- Category name is **paperbook** everywhere (routes, data dirs, UI copy). Never "posts".
- **Max 10 slides per post** — enforced in zod schema, editor add-slide button, AI prompts.
- Default template `spiral-notes`; default ratio `3:4` (1080×1440); ratios `4:5` (1080×1350) and `1:1` (1080×1080) selectable.
- Render at 2× and downscale (3:4 → capture 2160×2880 → output 1080×1440).
- All randomness (jitter, rotation) seeded from `post.seed` — identical input must produce identical pixels.
- Overflow never auto-shrinks text: render reports overflow, UI offers AI fix.
- AI never silently mutates post.json — every AI edit goes through diff-approve.
- ComfyUI jobs go to `http://127.0.0.1:8188` (Desktop app) so they appear in its queue/history. App must work fully (minus polish/assets) when ComfyUI is down.
- Data store is the filesystem under `data/paperbook/<slug>/`. No DB.
- Brand string default `iolar` (configurable in Settings).
- Node 20+, npm. All commands run from `C:\Users\sathwik\projects\comfyui-projects\iolar-studio`.
- Windows paths: always use `path.join`/`path.resolve` in code, never hardcoded separators.

## File Structure (final)

```
iolar-studio/
  package.json  tsconfig.json  next.config.ts  vitest.config.ts
  app/
    layout.tsx  page.tsx                      # shell redirect -> /dashboard
    dashboard/page.tsx
    paperbook/page.tsx                        # list
    paperbook/[slug]/page.tsx                 # editor
    assets/page.tsx
    settings/page.tsx
    reels/page.tsx stories/page.tsx quotes/page.tsx memes/page.tsx   # "soon"
    api/paperbook/route.ts                    # GET list, POST create
    api/paperbook/[slug]/route.ts             # GET, PUT post.json
    api/paperbook/[slug]/render/route.ts      # POST render slide(s)
    api/paperbook/[slug]/revise/route.ts      # POST AI revise -> diff
    api/paperbook/[slug]/package/route.ts     # POST export
    api/paperbook/[slug]/polish/route.ts      # POST ComfyUI img2img
    api/comfy/status/route.ts                 # GET liveness + VRAM
    api/assets/route.ts                       # GET list, POST generate doodle
  components/
    AppShell.tsx ThemeProvider.tsx ComfyPill.tsx
    editor/BlockEditor.tsx editor/BlockForm.tsx editor/SlideChips.tsx
    editor/PreviewPane.tsx editor/AiDrawer.tsx editor/DiffCard.tsx
  lib/
    schema.ts                                 # zod Post schema + types
    store.ts                                  # fs CRUD for posts
    settings.ts                               # settings.json load/save
    rng.ts                                    # mulberry32 seeded RNG
    renderer/blocks.ts                        # block -> HTML
    renderer/page.ts                          # slide HTML assembly
    renderer/capture.ts                       # Playwright screenshot + sharp downscale + overflow
    ai/claude.ts                              # claude CLI spawn
    ai/revise.ts                              # revise/paginate prompts + JSON extraction
    ai/diff.ts                                # post diff -> block diffs
    comfy/client.ts                           # HTTP client for 8188
    comfy/assets.ts                           # doodle t2i workflow
    comfy/polish.ts                           # img2img workflow
    packageExport.ts                          # export folder builder
  templates/
    _shared/base.css _shared/jitter.js _shared/rough.min.js _shared/fonts/*.woff2 _shared/fonts.css
    spiral-notes/template.html spiral-notes/manifest.json
    margin-qa/…  blackboard/…  studygram-pastel/…  engineer-grid/…
    terminal-dark/…  legal-pad/…  sticky-wall/…
  data/paperbook/            data/settings.json
  assets/doodles/
  tests/ (mirrors lib/ + api smoke)
```

---

### Task 1: Project scaffold + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `app/layout.tsx`, `app/page.tsx`, `.gitignore`

**Interfaces:**
- Produces: running Next dev server, `npm test` (vitest) green, path alias `@/*`.

- [ ] **Step 1: Scaffold Next.js**

```bash
cd C:\Users\sathwik\projects\comfyui-projects\iolar-studio
npx create-next-app@latest . --ts --app --no-tailwind --eslint --src-dir=false --import-alias "@/*" --use-npm --yes
npm i antd @ant-design/icons zod sharp roughjs
npm i -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom playwright
npx playwright install chromium
```

- [ ] **Step 2: vitest config**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: [] },
  resolve: { alias: { '@': path.resolve(__dirname) } },
});
```
Add to `package.json` scripts: `"test": "vitest run", "test:watch": "vitest"`.

- [ ] **Step 3: Root redirect**

`app/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
export default function Home() { redirect('/dashboard'); }
```
Create `app/dashboard/page.tsx` placeholder returning `<h1>Dashboard</h1>`.

- [ ] **Step 4: Verify**

Run: `npm run dev` → http://localhost:3100 redirects to /dashboard (set port: `"dev": "next dev -p 3100"` — 3000 is taken by the user's media server). Run `npm test` → passes (no tests yet is OK: add `--passWithNoTests` to script).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with antd, vitest, playwright"
```

---

### Task 2: Schema + store

**Files:**
- Create: `lib/schema.ts`, `lib/store.ts`, `lib/settings.ts`
- Test: `tests/schema.test.ts`, `tests/store.test.ts`

**Interfaces:**
- Produces:
  - `schema.ts`: `PostSchema` (zod), types `Post`, `Slide`, `Block` (discriminated union on `type`: `heading|paragraph|bullets|sidebox|table|code|diagram|callout|qa`), `RATIOS = {'3:4':[1080,1440],'4:5':[1080,1350],'1:1':[1080,1080]}`, `MAX_SLIDES = 10`, `validatePost(data: unknown): Post` (throws ZodError).
  - `store.ts`: `postDir(slug): string`, `listPosts(): Promise<PostMeta[]>` (`PostMeta = {slug,title,template,slideCount,status,updatedAt}`), `loadPost(slug): Promise<Post>`, `savePost(slug, post: Post): Promise<void>` (validates first), `createPost(slug, partial?): Promise<Post>`, `postStatus(slug): 'draft'|'rendered'|'polished'|'packaged'` (derived from dirs present).
  - `settings.ts`: `getSettings(): {brand:string; defaultTemplate:string; defaultRatio:string; comfyUrl:string}` with defaults `{brand:'iolar', defaultTemplate:'spiral-notes', defaultRatio:'3:4', comfyUrl:'http://127.0.0.1:8188'}`, `saveSettings(s)`.

- [ ] **Step 1: Write failing tests**

`tests/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validatePost, MAX_SLIDES } from '@/lib/schema';

const minimal = {
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 42,
  series: 'TEST SERIES', date: '29/08/2026',
  slides: [{ page_title: 'Page 1', blocks: [{ type: 'heading', text: 'Hi' }] }],
  caption: { text: 'c', hashtags: ['#x'] },
};

describe('PostSchema', () => {
  it('accepts a minimal valid post', () => {
    expect(validatePost(minimal).slides.length).toBe(1);
  });
  it('rejects unknown block type', () => {
    const bad = structuredClone(minimal);
    (bad.slides[0].blocks[0] as any).type = 'nope';
    expect(() => validatePost(bad)).toThrow();
  });
  it('rejects more than MAX_SLIDES slides', () => {
    const bad = structuredClone(minimal);
    bad.slides = Array.from({ length: MAX_SLIDES + 1 }, (_, i) => ({
      page_title: `P${i}`, blocks: [{ type: 'heading', text: 'x' }],
    }));
    expect(() => validatePost(bad)).toThrow(/10/);
  });
  it('rejects bad ratio', () => {
    expect(() => validatePost({ ...minimal, ratio: '9:16' })).toThrow();
  });
});
```

`tests/store.test.ts` (uses temp dir via env override `IOLAR_DATA_DIR`):
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

describe('store', () => {
  beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-')); });
  it('create -> load roundtrip and list', async () => {
    const { createPost, loadPost, listPosts } = await import('@/lib/store');
    await createPost('demo');
    const p = await loadPost('demo');
    expect(p.template).toBe('spiral-notes');
    expect((await listPosts())[0].slug).toBe('demo');
  });
  it('savePost rejects invalid post', async () => {
    const { createPost, savePost, loadPost } = await import('@/lib/store');
    await createPost('demo2');
    const p: any = await loadPost('demo2');
    p.ratio = 'bogus';
    await expect(savePost('demo2', p)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL** (`npm test` → cannot resolve `@/lib/schema`)

- [ ] **Step 3: Implement**

`lib/schema.ts`:
```ts
import { z } from 'zod';

export const MAX_SLIDES = 10;
export const RATIOS = { '3:4': [1080, 1440], '4:5': [1080, 1350], '1:1': [1080, 1080] } as const;
export const TEMPLATES = ['spiral-notes','margin-qa','blackboard','studygram-pastel','engineer-grid','terminal-dark','legal-pad','sticky-wall'] as const;
const Ink = z.enum(['blue','red','green','black','accent']).default('blue');

const BlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string().min(1), ink: Ink.optional() }),
  z.object({ type: z.literal('paragraph'), text: z.string().min(1) }),
  z.object({ type: z.literal('bullets'), items: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('sidebox'), title: z.string(), items: z.array(z.string()).min(1), ink: Ink.optional() }),
  z.object({ type: z.literal('table'), headers: z.array(z.string()).min(1), rows: z.array(z.array(z.string())).min(1) }),
  z.object({ type: z.literal('code'), lang: z.string().default('python'), lines: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('diagram'), kind: z.enum(['flow','memory-cells','tree','compare']), spec: z.record(z.string(), z.any()) }),
  z.object({ type: z.literal('callout'), style: z.enum(['tip','takeaway','cloud']), title: z.string(), text: z.string() }),
  z.object({ type: z.literal('qa'), q: z.string(), a_bullets: z.array(z.string()).min(1), example_code: z.array(z.string()).optional() }),
]);

export const PostSchema = z.object({
  brand: z.string().default('iolar'),
  template: z.enum(TEMPLATES).default('spiral-notes'),
  ratio: z.enum(['3:4','4:5','1:1']).default('3:4'),
  seed: z.number().int().default(42),
  series: z.string(),
  date: z.string(),
  slides: z.array(z.object({ page_title: z.string(), blocks: z.array(BlockSchema).min(1) }))
    .min(1).max(MAX_SLIDES, `max ${MAX_SLIDES} slides`),
  caption: z.object({ text: z.string(), hashtags: z.array(z.string()) }).default({ text: '', hashtags: [] }),
});

export type Post = z.infer<typeof PostSchema>;
export type Slide = Post['slides'][number];
export type Block = Slide['blocks'][number];
export function validatePost(data: unknown): Post { return PostSchema.parse(data); }
```

`lib/store.ts`:
```ts
import { promises as fs } from 'fs';
import path from 'path';
import { Post, validatePost } from './schema';
import { getSettings } from './settings';

export function dataRoot() { return process.env.IOLAR_DATA_DIR ?? path.join(process.cwd(), 'data'); }
export function postDir(slug: string) { return path.join(dataRoot(), 'paperbook', slug); }

export type PostMeta = { slug: string; title: string; template: string; slideCount: number; status: string; updatedAt: string };

export async function createPost(slug: string, partial: Partial<Post> = {}): Promise<Post> {
  const s = getSettings();
  const post = validatePost({
    brand: s.brand, template: s.defaultTemplate, ratio: s.defaultRatio, seed: 42,
    series: slug.replace(/-/g, ' ').toUpperCase(),
    date: new Date().toLocaleDateString('en-GB'),
    slides: [{ page_title: 'Page 1', blocks: [{ type: 'heading', text: 'New post' }] }],
    caption: { text: '', hashtags: [] }, ...partial,
  });
  await fs.mkdir(postDir(slug), { recursive: true });
  await fs.writeFile(path.join(postDir(slug), 'post.json'), JSON.stringify(post, null, 2));
  return post;
}

export async function loadPost(slug: string): Promise<Post> {
  return validatePost(JSON.parse(await fs.readFile(path.join(postDir(slug), 'post.json'), 'utf8')));
}

export async function savePost(slug: string, post: Post): Promise<void> {
  const valid = validatePost(post);
  await fs.writeFile(path.join(postDir(slug), 'post.json'), JSON.stringify(valid, null, 2));
}

async function exists(p: string) { try { await fs.access(p); return true; } catch { return false; } }

export async function postStatus(slug: string): Promise<string> {
  const d = postDir(slug);
  if (await exists(path.join(d, 'export'))) return 'packaged';
  if (await exists(path.join(d, 'renders', 'polished'))) return 'polished';
  if (await exists(path.join(d, 'renders'))) return 'rendered';
  return 'draft';
}

export async function listPosts(): Promise<PostMeta[]> {
  const root = path.join(dataRoot(), 'paperbook');
  await fs.mkdir(root, { recursive: true });
  const out: PostMeta[] = [];
  for (const slug of await fs.readdir(root)) {
    try {
      const p = await loadPost(slug);
      const st = await fs.stat(path.join(postDir(slug), 'post.json'));
      out.push({ slug, title: p.series, template: p.template, slideCount: p.slides.length,
        status: await postStatus(slug), updatedAt: st.mtime.toISOString() });
    } catch { /* skip broken dirs */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
```

`lib/settings.ts`:
```ts
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

export type Settings = { brand: string; defaultTemplate: string; defaultRatio: string; comfyUrl: string };
const DEFAULTS: Settings = { brand: 'iolar', defaultTemplate: 'spiral-notes', defaultRatio: '3:4', comfyUrl: 'http://127.0.0.1:8188' };
function file() { return path.join(process.env.IOLAR_DATA_DIR ?? path.join(process.cwd(), 'data'), 'settings.json'); }

export function getSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(file(), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Partial<Settings>) {
  mkdirSync(path.dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify({ ...getSettings(), ...s }, null, 2));
}
```

- [ ] **Step 4: Run tests, verify PASS** (`npm test`)

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: paperbook schema, fs store, settings"`

---

### Task 3: Shared render assets + spiral-notes template

**Files:**
- Create: `templates/_shared/base.css`, `templates/_shared/jitter.js`, `templates/_shared/fonts.css`, `templates/_shared/fonts/` (downloaded), `templates/_shared/rough.min.js` (copied from node_modules), `templates/spiral-notes/template.html`, `templates/spiral-notes/manifest.json`, `scripts/fetch-fonts.mjs`
- Test: `tests/templates.test.ts`

**Interfaces:**
- Produces: template contract. `template.html` contains literal markers `<!--HEAD-->` (font/base css injected), `<!--CONTENT-->` (block HTML), `<!--PAGEVARS-->` (JSON `{brand,date,series,page_title,pageNum,pageCount,seed,width,height}` as `<script>window.PAGE = {...}</script>`). `manifest.json`: `{ "name": "spiral-notes", "displayName": "Spiral Notes", "inks": {"blue":"#2748b3","red":"#c0392b","green":"#2d6a4f","black":"#2b2b2b","accent":"#c0392b"}, "supports": ["heading","paragraph","bullets","sidebox","table","code","diagram","callout","qa"], "contentSelector": "#content" }`. The element matching `contentSelector` is where overflow is measured.

- [ ] **Step 1: Font vendoring script**

`scripts/fetch-fonts.mjs` — downloads woff2 for Caveat(500,700), Kalam(300,400,700), Patrick Hand, Shadows Into Light, Architects Daughter, Gochi Hand, JetBrains Mono(400,700) from Google Fonts (fetch css2 URL with a Chrome UA header, parse `url(...woff2)`, download each to `templates/_shared/fonts/`, emit `templates/_shared/fonts.css` with `@font-face` rules using relative `fonts/<file>.woff2` paths). Run: `node scripts/fetch-fonts.mjs`. Copy rough: `cp node_modules/roughjs/bundled/rough.js templates/_shared/rough.min.js` (PowerShell: `Copy-Item`).

- [ ] **Step 2: base.css + jitter.js**

`templates/_shared/base.css`:
```css
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden}
#page{position:relative;width:100vw;height:100vh;overflow:hidden}
#content{position:relative;z-index:1}
.ink-blue{color:var(--ink-blue)}.ink-red{color:var(--ink-red)}
.ink-green{color:var(--ink-green)}.ink-black{color:var(--ink-black)}
.paper-texture{position:absolute;inset:0;z-index:3;pointer-events:none;opacity:.5;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .04 0'/></filter><rect width='300' height='300' filter='url(%23n)'/></svg>")}
.vignette{position:absolute;inset:0;z-index:3;pointer-events:none;
  background:radial-gradient(ellipse at center,transparent 62%,rgba(0,0,0,.10) 100%)}
```

`templates/_shared/jitter.js` (seeded; runs before capture; also draws rough.js decorations):
```js
// Deterministic RNG (mulberry32)
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
window.applyJitter = function(seed){
  const r = rng(seed);
  document.querySelectorAll('[data-jitter]').forEach(el=>{
    // wrap each character in a span with tiny rotation/offset
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes=[]; while(walk.nextNode()) nodes.push(walk.currentNode);
    nodes.forEach(n=>{
      const frag=document.createDocumentFragment();
      for(const ch of n.textContent){
        if(ch===' '){frag.append(' ');continue}
        const s=document.createElement('span');
        s.textContent=ch;
        s.style.display='inline-block';
        s.style.transform=`rotate(${(r()*2-1)*1.6}deg) translateY(${(r()*2-1)*0.8}px)`;
        frag.append(s);
      }
      n.replaceWith(frag);
    });
  });
  // rough.js boxes: any element with data-rough gets a hand-drawn rect behind it
  document.querySelectorAll('[data-rough]').forEach(el=>{
    const rect=el.getBoundingClientRect();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width',rect.width+8); svg.setAttribute('height',rect.height+8);
    svg.style.cssText=`position:absolute;left:${el.offsetLeft-4}px;top:${el.offsetTop-4}px;z-index:-1;overflow:visible`;
    const rc=rough.svg(svg,{options:{seed:Math.floor(r()*1e6)}});
    svg.appendChild(rc.rectangle(2,2,rect.width+4,rect.height+4,
      {stroke:el.dataset.rough||'#333',strokeWidth:2,roughness:1.6,bowing:1.2,fill:'none'}));
    el.style.position='relative'; el.appendChild(svg);
  });
  document.body.dataset.jitterDone='1';
};
```

- [ ] **Step 3: spiral-notes template**

`templates/spiral-notes/template.html` — full page implementing the reference-post-1 look. Structure (all CSS inline in file; values below are binding):
```html
<!DOCTYPE html><html><head><meta charset="utf-8"><!--HEAD-->
<style>
:root{--ink-blue:#2748b3;--ink-red:#c0392b;--ink-green:#2d6a4f;--ink-black:#2b2b2b}
body{font-family:'Kalam',cursive;background:#e8e4da}
#page{background:repeating-linear-gradient(#fdfdf6,#fdfdf6 calc(2.1vh - 1px),#dde4ec 2.1vh);
  padding:3.2vh 4vw 2.5vh 11vw;transform:rotate(-0.35deg)}
#page::before{content:"";position:absolute;left:0;top:0;bottom:0;width:7vw;background:#f1eee4;border-right:2px solid #e8b4b8}
.spiral{position:absolute;left:1vw;top:0;bottom:0;width:4.5vw;display:flex;flex-direction:column;justify-content:space-around;z-index:2}
.spiral i{height:1.1vh;border:.35vh solid #222;border-radius:50%;display:block;background:#fdfdf6}
.head{display:flex;justify-content:space-between;font-size:1.6vh;color:var(--ink-blue)}
.head .brand{font-family:'Caveat';font-size:2.2vh;text-decoration:underline wavy var(--ink-red) 2px}
.head .date{color:var(--ink-red)}
.series{font-family:'Caveat';text-align:center;font-size:3.2vh;font-weight:700;color:var(--ink-blue);
  text-decoration:underline wavy var(--ink-red) 2.5px;text-underline-offset:.8vh;margin:.6vh 0}
.page-title{font-family:'Patrick Hand';text-align:center;font-size:1.9vh;color:var(--ink-red);
  border:2px solid #333;border-radius:8px;display:table;margin:.8vh auto 1.2vh;padding:.1vh 1.6vw;background:#fffdf4}
/* block styles: .b-heading .b-paragraph .b-bullets .b-sidebox .b-table .b-code .b-callout .b-qa .b-diagram
   — sizes: headings 2.2vh Caveat bold blue wavy-underline; body 1.65vh Kalam #2b2b2b line-height 1.9;
   tables 1.4vh bordered 2px #445 with blue Caveat headers on #fffdf4;
   code 1.4vh 'JetBrains Mono' color blue on #fffdf4 dashed blue border;
   sidebox data-rough green frame, red underlined Caveat title;
   callout tip: lightbulb emoji + red title; takeaway: star + red box; cloud: green border-radius 50px */
</style></head>
<body><div id="page">
  <div class="spiral">…10 <i> elements…</div>
  <div class="head"><span class="brand" id="v-brand"></span><span class="date">Date : <span id="v-date"></span></span></div>
  <div class="series" id="v-series" data-jitter></div>
  <div class="page-title" id="v-ptitle" data-jitter></div>
  <div id="content"><!--CONTENT--></div>
  <div class="paper-texture"></div><div class="vignette"></div>
</div>
<script src="../_shared/rough.min.js"></script><script src="../_shared/jitter.js"></script>
<!--PAGEVARS-->
<script>
  document.getElementById('v-brand').textContent = PAGE.brand;
  document.getElementById('v-date').textContent = PAGE.date;
  document.getElementById('v-series').textContent = PAGE.series;
  document.getElementById('v-ptitle').textContent = `Page ${PAGE.pageNum} : ${PAGE.page_title}`;
  applyJitter(PAGE.seed + PAGE.pageNum);
</script></body></html>
```
The comment block above MUST be expanded into real CSS rules for every `.b-*` class (implementer: match reference post 1 screenshots in `docs/reference/` — copy the two analyzed posts' images there from the scratchpad in Task 3 Step 0 if still available, else follow the size/color values given here verbatim).

`templates/spiral-notes/manifest.json` as in Interfaces above.

- [ ] **Step 4: Template contract test**

`tests/templates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'templates');
const templateDirs = readdirSync(dir).filter(d => !d.startsWith('_'));

describe('template contract', () => {
  it.each(templateDirs)('%s has required markers and manifest', (t) => {
    const html = readFileSync(path.join(dir, t, 'template.html'), 'utf8');
    expect(html).toContain('<!--CONTENT-->');
    expect(html).toContain('<!--PAGEVARS-->');
    expect(html).toContain('<!--HEAD-->');
    const m = JSON.parse(readFileSync(path.join(dir, t, 'manifest.json'), 'utf8'));
    expect(m.name).toBe(t);
    expect(m.contentSelector).toBeTruthy();
    expect(m.inks).toBeTruthy();
  });
  it('shared assets exist', () => {
    for (const f of ['base.css','jitter.js','rough.min.js','fonts.css'])
      expect(existsSync(path.join(dir, '_shared', f))).toBe(true);
  });
});
```
Run → PASS for spiral-notes.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: shared render assets, spiral-notes template, fonts vendored"`

---

### Task 4: Block HTML renderer

**Files:**
- Create: `lib/renderer/blocks.ts`, `lib/rng.ts`
- Test: `tests/blocks.test.ts`

**Interfaces:**
- Consumes: `Block` from `lib/schema`.
- Produces: `renderBlockHtml(block: Block): string` — pure function, returns HTML string using classes `.b-heading .b-paragraph .b-bullets .b-sidebox .b-table .b-code .b-diagram .b-callout .b-qa`, ink via `.ink-*` classes, `data-jitter` on handwritten text nodes, `data-rough="<color>"` on framed boxes. `escapeHtml(s: string): string`. `lib/rng.ts`: `mulberry32(seed: number): () => number`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { renderBlockHtml } from '@/lib/renderer/blocks';

describe('renderBlockHtml', () => {
  it('escapes HTML in text', () => {
    const h = renderBlockHtml({ type: 'heading', text: '<script>x' } as any);
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
  });
  it('renders table with all cells', () => {
    const h = renderBlockHtml({ type: 'table', headers: ['A','B'], rows: [['1','2'],['3','4']] } as any);
    for (const c of ['A','B','1','2','3','4']) expect(h).toContain(c);
    expect(h).toContain('b-table');
  });
  it('renders code without jitter (code must stay legible)', () => {
    const h = renderBlockHtml({ type: 'code', lang: 'python', lines: ['print(1)'] } as any);
    expect(h).toContain('b-code');
    expect(h).not.toContain('data-jitter');
  });
  it('sidebox carries rough frame with ink color', () => {
    const h = renderBlockHtml({ type: 'sidebox', title: 'T', items: ['x'], ink: 'green' } as any);
    expect(h).toContain('data-rough');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement** — switch on `block.type`, one small private function per type, `escapeHtml` applied to every user string. Table = real `<table class="b-table">`; qa = `Q./Ans→` structure matching margin-qa reference; diagram v1 renders `kind:'flow'` as inline flex of `data-rough` nodes joined by `→` spans, other kinds render as a `.b-diagram-todo` box listing the spec keys (placeholder box is a *rendered visual*, not a code placeholder — spec §4 allows staged diagram support; document in code comment).

- [ ] **Step 4: Run, verify PASS**

- [ ] **Step 5: Commit** — `feat: block -> HTML renderer with escaping and jitter/rough attributes`

---

### Task 5: Slide assembly + Playwright capture + overflow guard

**Files:**
- Create: `lib/renderer/page.ts`, `lib/renderer/capture.ts`
- Test: `tests/render.e2e.test.ts` (runs real Chromium; tag `describe.skipIf(process.env.CI)` not needed — local only)

**Interfaces:**
- Consumes: `renderBlockHtml`, template contract from Task 3, `RATIOS`.
- Produces:
  - `page.ts`: `buildSlideHtml(post: Post, slideIndex: number): string` — loads `templates/<post.template>/template.html`, injects `<!--HEAD-->` → `<link>` tags for `_shared/fonts.css` + `_shared/base.css` (absolute file:// safe relative paths), `<!--CONTENT-->` → joined block HTML, `<!--PAGEVARS-->` → `<script>window.PAGE={...}</script>` with `{brand,date,series,page_title,pageNum:slideIndex+1,pageCount,seed,width,height}`.
  - `capture.ts`: `renderSlide(post: Post, slideIndex: number, outPath: string): Promise<{overflowPx: number}>` — writes temp html into the template dir (so relative asset paths resolve), launches chromium `viewport {width: W*2, height: H*2}` from `RATIOS[post.ratio]`, `page.goto(file://…)`, waits for `body[data-jitter-done="1"]`, measures `overflowPx = max(0, content.scrollHeight + contentTop - pageHeight)` via the manifest's `contentSelector`, screenshots, sharp-resizes to W×H, writes PNG, deletes temp file. Reuses a module-level browser instance (`getBrowser()` singleton) for speed. Also exports `renderAll(post, outDir): Promise<{slide: number; overflowPx: number}[]>` writing `slide-01.png`…

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderSlide } from '@/lib/renderer/capture';
import { validatePost } from '@/lib/schema';
import path from 'path'; import { tmpdir } from 'os'; import { existsSync } from 'fs';
import sharp from 'sharp';

const post = validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 7,
  series: 'RENDER TEST', date: '29/08/2026',
  slides: [{ page_title: 'SMOKE', blocks: [
    { type: 'heading', text: '1. Hello render' },
    { type: 'bullets', items: ['one', 'two'] },
    { type: 'table', headers: ['A','B'], rows: [['1','2']] },
  ]}],
  caption: { text: '', hashtags: [] },
});

describe('renderSlide', () => {
  it('produces a 1080x1440 png with no overflow', async () => {
    const out = path.join(tmpdir(), `iolar-test-${Date.now()}.png`);
    const r = await renderSlide(post, 0, out);
    expect(existsSync(out)).toBe(true);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1440]);
    expect(r.overflowPx).toBe(0);
  }, 60_000);
  it('reports overflow for absurd content, never shrinks', async () => {
    const big = structuredClone(post);
    big.slides[0].blocks = Array.from({ length: 40 }, () => ({ type: 'paragraph', text: 'Long line of handwritten content that keeps going. '.repeat(4) } as any));
    const out = path.join(tmpdir(), `iolar-ovf-${Date.now()}.png`);
    const r = await renderSlide(big, 0, out);
    expect(r.overflowPx).toBeGreaterThan(0);
  }, 60_000);
  it('is deterministic: same seed => identical bytes', async () => {
    const a = path.join(tmpdir(), `iolar-a-${Date.now()}.png`);
    const b = path.join(tmpdir(), `iolar-b-${Date.now()}.png`);
    await renderSlide(post, 0, a); await renderSlide(post, 0, b);
    const [ba, bb] = await Promise.all([sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer()]);
    expect(Buffer.compare(ba, bb)).toBe(0);
  }, 90_000);
});
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement per Interfaces** (plain `playwright` `chromium.launch({headless:true})`; determinism requires `--force-color-profile=srgb --disable-lcd-text --hide-scrollbars` launch args and font files vendored — no network).
- [ ] **Step 4: Run, verify PASS** (3 tests, real browser)
- [ ] **Step 5: Commit** — `feat: slide assembly, Playwright capture, overflow guard, deterministic renders`

---

### Task 6: margin-qa template

**Files:**
- Create: `templates/margin-qa/template.html`, `templates/margin-qa/manifest.json`
- Test: existing `tests/templates.test.ts` picks it up automatically; extend `tests/render.e2e.test.ts` with one smoke render.

**Interfaces:** same contract; inks `{"blue":"#2b3f8f","red":"#c0392b","green":"#2d6a4f","black":"#333","accent":"#e8a0a8"}`.

- [ ] **Step 1:** Add render smoke test (same post as Task 5 test but `template:'margin-qa'`, plus a `qa` block: `{type:'qa', q:'What is Python?', a_bullets:['high-level','interpreted'], example_code:['x = 10  # int']}`). Run → FAIL (template missing).
- [ ] **Step 2:** Build template cloning reference post 2: white page `#fff` ruled lines, red margin line at 13% left, PAGE N top-right (Patrick Hand, blue, underline), Insta-ID badge top-left (`📷 Insta ID : ` + brand, red wavy underline), big Caveat title from `series`, cloud callout style = green 50px-radius bubble rotated 2deg, `qa` blocks styled: Q red Kalam bold with `Q1.` auto-numbering (CSS counter), `Ans→` red double-underline then blue answer bullets, example_code in dashed blue box.
- [ ] **Step 3:** Run tests → PASS. Visual check: open the temp render PNG, compare against reference.
- [ ] **Step 4:** Commit — `feat: margin-qa template (reference post 2 clone)`

---

### Task 7: API routes — paperbook CRUD + render

**Files:**
- Create: `app/api/paperbook/route.ts`, `app/api/paperbook/[slug]/route.ts`, `app/api/paperbook/[slug]/render/route.ts`
- Test: `tests/api.paperbook.test.ts` (call route handlers directly as functions with `NextRequest`)

**Interfaces:**
- Produces REST contract used by all UI tasks:
  - `GET /api/paperbook` → `PostMeta[]`
  - `POST /api/paperbook` body `{slug}` → created `Post` (400 on invalid slug `[^a-z0-9-]` or exists)
  - `GET /api/paperbook/:slug` → `Post`; `PUT` body `Post` → validates, saves, returns saved `Post` (400 with zod issues on invalid)
  - `POST /api/paperbook/:slug/render` body `{slide?: number}` → renders one slide or all into `data/paperbook/<slug>/renders/`, returns `{results: [{slide, overflowPx, file}]}`; PNGs additionally served by `GET /api/paperbook/:slug/render?slide=N&t=<cachebust>` returning the PNG bytes (Content-Type image/png).

- [ ] **Step 1:** Failing tests: create → list → get → put roundtrip; put with 11 slides → 400; render returns file that exists.
- [ ] **Step 2:** Run, verify FAIL.
- [ ] **Step 3:** Implement handlers as thin wrappers over `store.ts` / `capture.ts` (try/catch → `NextResponse.json({error}, {status})`).
- [ ] **Step 4:** Run, verify PASS.
- [ ] **Step 5:** Commit — `feat: paperbook CRUD and render API routes`

---

### Task 8: App shell — Midnight Studio theme + light variant

**Files:**
- Create: `components/ThemeProvider.tsx`, `components/AppShell.tsx`, `components/ComfyPill.tsx`, `app/api/comfy/status/route.ts`; Modify: `app/layout.tsx`; Create category placeholder pages `app/reels/page.tsx`, `app/stories/page.tsx`, `app/quotes/page.tsx`, `app/memes/page.tsx`.

**Interfaces:**
- Produces: `<AppShell>` wrapping all pages: antd `Layout` with fixed 220px sider (logo "iolar studio", menu: Dashboard, Paperbook, Reels(soon), Stories(soon), Quote cards(soon), Memes(soon), Assets, Settings — "soon" items disabled with badge), topbar slot, ComfyPill bottom of sider. `ThemeProvider` holds `theme: 'dark'|'light'` in localStorage + React context, exposes `useTheme()`; antd `ConfigProvider` token sets:
  - dark (default): `colorPrimary:'#7c5cff'`, `colorBgBase:'#0f1016'`, `colorBgContainer:'#14151f'`, `colorBorder:'#23253c'`, `borderRadius:10`, algorithm `theme.darkAlgorithm`; gradient accents via CSS `linear-gradient(135deg,#7c5cff,#3ec5ff)` on primary buttons (`.btn-glow` class), glow shadows.
  - light: `colorPrimary:'#5b45e0'`, default algorithm, `colorBgLayout:'#f5f5f7'`.
  - Toggle button (sun/moon) in topbar.
- `ComfyPill`: polls `GET /api/comfy/status` every 15s → `{up: boolean, gpu?: string, vramFreeGb?: number, vramTotalGb?: number}`; green dot + "ComfyUI live · RTX 4090" + VRAM bar, red dot "ComfyUI offline" when down.
- `app/api/comfy/status/route.ts`: fetches `${getSettings().comfyUrl}/system_stats` with 2s timeout, maps devices[0].

- [ ] **Step 1:** Smoke test `tests/shell.test.tsx`: render `<AppShell><p>hi</p></AppShell>` inside ThemeProvider; assert menu labels `Paperbook`, `Reels` present and Reels menu item has `ant-menu-item-disabled` class; toggle theme flips `document.documentElement.dataset.theme`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS + `npm run dev` eyeball dark/light.
- [ ] **Step 5:** Commit — `feat: Midnight Studio app shell, dark/light themes, comfy status pill`

---

### Task 9: Dashboard + Paperbook list pages

**Files:**
- Create: `app/dashboard/page.tsx` (replace placeholder), `app/paperbook/page.tsx`

**Interfaces:**
- Consumes: `GET /api/paperbook`, `GET /api/comfy/status`.
- Dashboard: 4 stat cards (posts count, slides rendered count from statuses, comfy jobs placeholder "—", packaged count), 5 category cards (Paperbook → `/paperbook`; others disabled "soon"), recent-5 table. Paperbook list: antd Table (slug, title, template tag, slides, status tag color-mapped draft=orange/rendered=blue/polished=purple/packaged=green, updated), "New post" modal (slug input validated `^[a-z0-9-]+$`) → POST → navigate to editor.

- [ ] **Step 1:** Test: list page renders rows from mocked fetch; new-post modal rejects `Bad Slug!`.
- [ ] **Step 2:** FAIL → **Step 3:** implement (client components, `fetch` + `useEffect`; keep it simple, no SWR) → **Step 4:** PASS.
- [ ] **Step 5:** Commit — `feat: dashboard and paperbook list`

---

### Task 10: Post editor — blocks, chips, preview

**Files:**
- Create: `app/paperbook/[slug]/page.tsx`, `components/editor/BlockEditor.tsx`, `components/editor/BlockForm.tsx`, `components/editor/SlideChips.tsx`, `components/editor/PreviewPane.tsx`
- Test: `tests/editor.test.tsx`

**Interfaces:**
- Consumes: CRUD + render API (Task 7 contract).
- Produces the core screen:
  - Toolbar: template Select (all 8 from `TEMPLATES`, options for not-yet-built templates disabled until their dir exists — server exposes built list via `GET /api/paperbook?meta=templates` returning `{templates: string[]}` (extend Task 7 route)), ratio Select, saved-state tag (dirty tracking), buttons: Render slide, Render all, Polish (disabled if comfy down), Package.
  - `SlideChips`: 1..N chips + `+` (disabled at `MAX_SLIDES`, tooltip "max 10 slides"), delete via chip context menu (antd Dropdown), drag-reorder skipped (YAGNI).
  - `BlockEditor`: list of `BlockForm` cards for selected slide; each card: type label, per-type antd inputs (heading/paragraph: TextArea; bullets/sidebox items: TextArea one-per-line; table: editable grid of Inputs with add/remove row+col buttons; code: TextArea monospace; callout: style Select + title + text; qa: q Input, a_bullets TextArea, example_code TextArea; diagram: kind Select + spec JSON TextArea with validity hint), actions: up/down/duplicate/delete; "Add block" Dropdown with all 9 types.
  - `PreviewPane`: sticky; `<img src="/api/paperbook/<slug>/render?slide=N&t=<ts>">` refreshed after every successful render; "Re-render" + "Contact sheet" (modal grid of all slide imgs); overflow banner (red) when last render result `overflowPx > 0` showing px amount + "Auto-fix with AI" button (wired in Task 12).
  - Save: PUT on every apply/edit debounce 800ms; render buttons call render API then bump img timestamp.

- [ ] **Step 1:** Tests: renders blocks of a mocked post; add-slide disabled when 10 slides; add-block menu contains all 9 types; table editor adds a row.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS + manual dev-server pass (create post, edit, render slide 1, see preview).
- [ ] **Step 5:** Commit — `feat: paperbook editor with block forms and live preview`

---

### Task 11: Claude CLI bridge + revise diff engine

**Files:**
- Create: `lib/ai/claude.ts`, `lib/ai/revise.ts`, `lib/ai/diff.ts`, `app/api/paperbook/[slug]/revise/route.ts`
- Test: `tests/ai.diff.test.ts`, `tests/ai.revise.test.ts` (claude spawn mocked), `tests/api.revise.test.ts`

**Interfaces:**
- `claude.ts`: `runClaude(prompt: string, opts?: {timeoutMs?: number}): Promise<string>` — spawns `claude -p <prompt> --output-format text` via `child_process.execFile` (shell:false, prompt passed as argv, `windowsHide:true`, default timeout 120s), returns stdout, throws `ClaudeUnavailableError` when binary missing (UI shows "Claude CLI not found").
- `revise.ts`: `revisePost(post: Post, request: string, scope: 'slide'|'post'|'caption', slideIndex?: number): Promise<Post>` — builds prompt: system rules (return ONLY JSON matching schema; max 10 slides; keep unrelated content byte-identical; for scope slide only touch that slide; pagination commands allowed: split/merge/fit-into-N/reflow-overflow), embeds current post JSON + request; `extractJson(s: string): unknown` strips markdown fences/prose; result → `validatePost` (throw on invalid with one automatic retry appending the zod error to the prompt).
- `diff.ts`: `diffPosts(before: Post, after: Post): SlideDiff[]` where `SlideDiff = {slide: number, kind: 'added'|'removed'|'changed', blocks: {index: number, kind: 'added'|'removed'|'changed', before?: Block, after?: Block}[]}` — JSON-stringify compare per block.
- Route: `POST /api/paperbook/:slug/revise` body `{request, scope, slideIndex?}` → `{proposal: Post, diff: SlideDiff[]}` — does NOT save. `PUT` with proposal happens through the normal save endpoint after user approval (client-side apply). Chat history appended to `data/paperbook/<slug>/chat.json` (`{role,text,ts}[]`).

- [ ] **Step 1:** Failing tests: `extractJson` handles fenced/prefixed output; `diffPosts` flags changed block + added slide, ignores identical; revise route (with `runClaude` mocked via `vi.mock`) returns proposal+diff and does not modify post.json on disk; revise proposal with 11 slides → 422.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit — `feat: claude bridge, revise engine with schema-validated diffs`

---

### Task 12: AI chat drawer UI + auto-pagination

**Files:**
- Create: `components/editor/AiDrawer.tsx`, `components/editor/DiffCard.tsx`; Modify: `app/paperbook/[slug]/page.tsx` (FAB + drawer mount, overflow banner wiring)

**Interfaces:**
- Consumes: revise route (Task 11 contract).
- Produces: floating "✦ Revise with AI" button (gradient glow) → antd Drawer (380px): scope segmented control (This slide / Whole post / Caption), message list from `chat.json`, input + send. On response: assistant message + `DiffCard` per changed slide — before/after lines (red/green rows, JSON-pretty for non-text blocks), buttons Apply & re-render / Discard / Apply all. Apply = PUT proposal → re-render affected slides → refresh preview. Overflow banner "Auto-fix with AI" sends canned request `Slide N overflows by <px>px. Move or condense content to fit; use another slide if needed (max 10).` with scope 'post'. Pagination examples in placeholder text ("fit this into 7 slides…", "split slide 3…"). While claude runs: typing indicator; failure → antd message.error with stderr summary.

- [ ] **Step 1:** Tests: drawer renders history; DiffCard shows before/after texts; Apply calls PUT with proposal (fetch mocked).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS + manual end-to-end with real claude CLI once (`claude -p` present on this machine).
- [ ] **Step 5:** Commit — `feat: AI revise drawer with diff-approve and auto-pagination`

---

### Task 13: ComfyUI client + doodle assets + Assets page

**Files:**
- Create: `lib/comfy/client.ts`, `lib/comfy/assets.ts`, `app/api/assets/route.ts`, `app/assets/page.tsx`
- Test: `tests/comfy.client.test.ts` (fetch mocked)

**Interfaces:**
- `client.ts`: `comfyFetch(path, init?)` base on `getSettings().comfyUrl`; `getStats(): Promise<{up, gpu, vramFreeGb, vramTotalGb}>`; `queuePrompt(workflow: object): Promise<{prompt_id: string}>` (POST `/prompt` `{prompt: workflow}`); `waitForJob(prompt_id, timeoutMs=300000): Promise<{images: {filename, subfolder, type}[]}>` (poll `/history/<id>` 2s interval); `fetchImage(ref): Promise<Buffer>` (GET `/view?filename=…&subfolder=…&type=…`); `saveWorkflowToDesktop(name, workflow)` writes JSON to `C:\Users\sathwik\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\user\default\workflows\<name>.json` (path from settings key `desktopWorkflowsDir`, default that value) so user can open it in the Desktop UI.
- `assets.ts`: `generateDoodle(prompt: string, name: string): Promise<string>` — builds minimal t2i API workflow (CheckpointLoaderSimple with settings key `comfyCheckpoint` (default first checkpoint from `/object_info` CheckpointLoaderSimple choices), CLIPTextEncode positive: `"minimalist hand-drawn doodle sketch of ${prompt}, black ink on white background, sticker style"`, negative `"photo, realistic, color photograph, text"`, EmptyLatentImage 768×768, KSampler seed 42/steps 20/cfg 7, VAEDecode, SaveImage prefix `iolar-doodle`), queues, waits, downloads to `assets/doodles/<name>.png`, also `saveWorkflowToDesktop('iolar-doodle', wf)`.
- API: `GET /api/assets` → `{files: string[]}`; `POST /api/assets` body `{prompt, name}` → 503 `{error:'comfyui offline'}` when down, else `{file}`.
- Page: grid of doodles (antd Card + Image), generate form (name + prompt), spinner during job, note "job visible in ComfyUI Desktop queue".

- [ ] **Step 1:** Failing tests: `getStats` maps system_stats shape (mock fetch with the real response captured earlier: ram/devices bytes → Gb rounded 1dp); `queuePrompt` posts `{prompt}` envelope; `generateDoodle` (fetch fully mocked) writes file + workflow JSON.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS + one real doodle generation against live Desktop instance (verify it appears in Desktop queue/history).
- [ ] **Step 5:** Commit — `feat: comfyui client, doodle asset generation, assets page`

---

### Task 14: Polish pass (img2img) + package/export

**Files:**
- Create: `lib/comfy/polish.ts`, `lib/packageExport.ts`, `app/api/paperbook/[slug]/polish/route.ts`, `app/api/paperbook/[slug]/package/route.ts`
- Test: `tests/package.test.ts` (fs only), `tests/api.polish.test.ts` (comfy mocked)

**Interfaces:**
- `polish.ts`: `polishSlide(pngPath: string, outPath: string): Promise<void>` — uploads PNG via POST `/upload/image` (multipart, `overwrite:true`), builds img2img workflow: LoadImage → VAEEncode → KSampler `{denoise: 0.12, steps: 14, cfg: 6, seed: 42}` → VAEDecode → SaveImage prefix `iolar-polish`; waits, downloads result. `polishPost(slug): Promise<{slides: number}>` — iterates `renders/slide-*.png` → `renders/polished/slide-*.png`; `saveWorkflowToDesktop('iolar-polish', wf)`.
- `packageExport.ts`: `packagePost(slug): Promise<{dir: string, files: string[]}>` — copies polished PNGs if present else raw renders → `export/01.png…NN.png`, writes `export/caption.txt` = caption.text + blank line + hashtags space-joined; refuses (`throw new Error('render first')`) if no renders; refuses if any slide's last render had overflow (persist render results to `renders/render-report.json` in Task 7's render route; read here).
- Routes: `POST …/polish` → 503 comfy down; `POST …/package` → `{dir, files}`; editor toolbar buttons wired (Modify `app/paperbook/[slug]/page.tsx`).

- [ ] **Step 1:** Failing tests: package copies renders + writes caption.txt content exactly; package throws without renders; overflow in report blocks packaging; polish route 503 when stats down.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS + one real polish A/B against live instance; if text degrades at 0.12 denoise, lower to 0.08 and re-check (record chosen value in settings default `polishDenoise`).
- [ ] **Step 5:** Commit — `feat: comfyui polish pass and package export`

---

### Task 15: Remaining templates, batch 1 — blackboard, studygram-pastel, engineer-grid

**Files:**
- Create: `templates/blackboard/…`, `templates/studygram-pastel/…`, `templates/engineer-grid/…` (template.html + manifest.json each)

**Interfaces:** same template contract (Task 3). Binding style tokens (from approved gallery):
- blackboard: bg `radial-gradient(#2f4438,#1f3128)`, wood frame border `6px #6b4f35` inset 2.5%, chalk inks `{"blue":"#8fe3b0","red":"#ffb3c1","green":"#8fe3b0","black":"#e8e4d5","accent":"#f2c94c"}`, headings Caveat #f3f0e2, boxes dashed `#f2c94c`, chalk-dust noise overlay (reuse base texture, opacity .12, white).
- studygram-pastel: bg `linear-gradient(#faf6ef,#f7f1e6)`, inks `{"blue":"#5a4a42","red":"#d4886f","green":"#7fae94","black":"#6b5d54","accent":"#d4886f"}`, keyword `<mark>`-style highlighter (linear-gradient underlays `#ffd9a0`/`#f9c6d0`/`#bfe6cf` — renderer wraps `**bold**`-marked words from text in `<span class="hl">`), washi-tape header strip `rgba(244,180,180,.55)` rotated −2°, white rounded cards with soft shadow for sidebox/callout.
- engineer-grid: graph-paper bg (`#f4f7fa` + 14px grid lines `rgba(70,110,160,.16)`), inks `{"blue":"#24558c","red":"#d35400","green":"#1d6d40","black":"#2c3e50","accent":"#d35400"}`, Architects Daughter, stamp box top-right `IOLAR · REV A`, hard-shadow boxes `3px 3px 0 rgba(36,85,140,.18)`, flow diagram nodes native to this template's look.

- [ ] **Step 1:** Extend render e2e smoke test with the 3 template names (parameterized `it.each`). FAIL.
- [ ] **Step 2:** Build the 3 templates. Contract test + smoke renders PASS.
- [ ] **Step 3:** Contact-sheet eyeball of each against the approved gallery mockups.
- [ ] **Step 4:** Commit — `feat: blackboard, studygram-pastel, engineer-grid templates`

---

### Task 16: Remaining templates, batch 2 — terminal-dark, legal-pad, sticky-wall

**Files:** `templates/terminal-dark/…`, `templates/legal-pad/…`, `templates/sticky-wall/…`

**Interfaces:** contract as before. Tokens:
- terminal-dark: bg `#12131c`, window bar (3 traffic dots + `iolar@notes ~ <slug>.md` JetBrains Mono `#5b607a`), inks `{"blue":"#82b7ff","red":"#ff7eb6","green":"#7ee2a8","black":"#c6cbe3","accent":"#7ee2a8"}`, Gochi Hand handwriting with neon `text-shadow: 0 0 12px` per ink, code blocks native dark `#1a1c2a` border-left `3px #7ee2a8`.
- legal-pad: bg repeating `#f7e9a0`/line `#d8c56f`, red margin line 11%, top rip strip dashed `#b7a24e`, inks `{"blue":"#1d3557","red":"#c0392b","green":"#1d6d40","black":"#26415e","accent":"#c0392b"}`, Shadows Into Light body, coffee-stain ring bottom-right (blurred border circle `rgba(139,94,42,.25)`), whole page rotate −0.5°.
- sticky-wall: cork bg `#b9936c` + dot noise, every block renders as its own pinned note (palette rotation `#fff8b8 #c9f2d0 #ffd6e0 #cfe8ff #ffe0b8`, seeded rotation ±3°, pin dot on title card, drop shadows); layout = CSS columns 2 with gap (blocks flow into masonry-ish wall); red string SVG between consecutive notes omitted at >6 blocks (clutter guard).

- [ ] Steps mirror Task 15 (extend smoke test → build → eyeball → commit `feat: terminal-dark, legal-pad, sticky-wall templates`).

---

### Task 17: Golden render regression suite + sample post + docs

**Files:**
- Create: `tests/golden.test.ts`, `tests/fixtures/golden-post.json`, `tests/golden/` (approved PNGs), `scripts/approve-goldens.mjs`, `README.md`

**Interfaces:**
- `golden-post.json`: one representative post exercising every block type across 3 slides.
- `scripts/approve-goldens.mjs`: renders fixture with every built template into `tests/golden/<template>-<slide>.png` (run once, inspect, commit).
- `tests/golden.test.ts`: re-renders and byte-compares against goldens (`it.each(templates)`); mismatch fails with hint `node scripts/approve-goldens.mjs` after intentional changes.
- README: quickstart (dev server port 3100, test, approve-goldens), pipeline diagram, template-authoring guide (contract, tokens, manifest), claude CLI + ComfyUI Desktop requirements.

- [ ] **Step 1:** Write fixture + script, generate goldens, eyeball all, commit goldens.
- [ ] **Step 2:** Golden test PASS on re-run (proves determinism across the suite).
- [ ] **Step 3:** Full `npm test` green; `npm run build` clean.
- [ ] **Step 4:** Commit — `test: golden render regression suite; docs: README`

---

## Self-Review (done at write time)

- **Spec coverage:** §1 purpose+cap→T2/T10/T11; §2 pipeline→T4/T5/T13/T14; §3 app/UI/screens/themes→T1/T8/T9/T10, settings page folded into T8 shell nav + T13 settings usage (settings UI page = simple form over `lib/settings.ts`, included in T9 scope — *added to T9 files*); §4 schema→T2; §5 render/ratios/overflow/templates→T3/T5/T6/T15/T16; §6 AI→T11/T12; §7 ComfyUI→T13/T14; §8 testing→T5/T17 (+ per-task tests); §9 out-of-scope respected.
- **Placeholder scan:** diagram kinds beyond `flow` render as visible staged box (spec permits staged diagram support; real kinds are follow-up work, not hidden TODO — noted in T4). Template CSS abbreviations in T3 carry binding values.
- **Type consistency:** `Post/Block/PostMeta/SlideDiff`, `renderBlockHtml`, `renderSlide/renderAll`, `runClaude/revisePost/diffPosts`, `queuePrompt/waitForJob` names consistent across tasks.

**Amendment from review:** Task 9 files also include `app/settings/page.tsx` (antd Form over GET/PUT `app/api/settings/route.ts`, thin wrapper on `lib/settings.ts` — same test pattern as list page).
