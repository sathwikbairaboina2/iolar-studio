import { promises as fs } from 'fs';
import path from 'path';
import { Post, validatePost } from './schema';
import { getSettings } from './settings';

export function dataRoot() {
  return process.env.IOLAR_DATA_DIR ?? path.join(process.cwd(), 'data');
}

export function postDir(slug: string) {
  return path.join(dataRoot(), 'paperbook', slug);
}

export type PostMeta = {
  slug: string;
  title: string;
  template: string;
  slideCount: number;
  status: string;
  updatedAt: string;
};

export async function createPost(slug: string, partial: Partial<Post> = {}): Promise<Post> {
  const s = getSettings();
  const post = validatePost({
    brand: s.brand,
    template: s.defaultTemplate,
    ratio: s.defaultRatio,
    seed: 42,
    series: slug.replace(/-/g, ' ').toUpperCase(),
    date: new Date().toLocaleDateString('en-GB'),
    slides: [{ page_title: 'Page 1', blocks: [{ type: 'heading', text: 'New post' }] }],
    caption: { text: '', hashtags: [] },
    ...partial,
  });
  await fs.mkdir(postDir(slug), { recursive: true });
  await fs.writeFile(path.join(postDir(slug), 'post.json'), JSON.stringify(post, null, 2));
  return post;
}

export async function loadPost(slug: string): Promise<Post> {
  const raw = await fs.readFile(path.join(postDir(slug), 'post.json'), 'utf8');
  return validatePost(JSON.parse(raw));
}

export async function savePost(slug: string, post: Post): Promise<void> {
  const valid = validatePost(post);
  await fs.mkdir(postDir(slug), { recursive: true });
  await fs.writeFile(path.join(postDir(slug), 'post.json'), JSON.stringify(valid, null, 2));
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

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
      out.push({
        slug,
        title: p.series,
        template: p.template,
        slideCount: p.slides.length,
        status: await postStatus(slug),
        updatedAt: st.mtime.toISOString(),
      });
    } catch {
      // skip broken dirs
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
